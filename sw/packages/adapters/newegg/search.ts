import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";

import { RateLimitError } from "../errors";

/** Read an integer env var, treating "", missing, or non-numeric as `def`.
 *  GitHub Actions sets `vars.X` to an empty string when undefined, which would
 *  otherwise coerce to 0 via `Number("" ?? def)`. */
function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * Low-level Newegg HTTP fetch. Kept separate from the adapter so the transport
 * can be swapped without touching normalization logic.
 *
 * Two anti-rate-limit mechanisms live here:
 *
 *  1. Proxy rotation — when NEWEGG_PROXIES is set, each request is dispatched
 *     through one of a pool of proxy IPs. A 429 on a proxy cools that IP down
 *     (honouring Retry-After) and the request is retried on the next proxy, so
 *     a rate-limited IP is bypassed instead of blocking the whole poller.
 *
 *  2. Adaptive concurrency (AIMD) — the process-wide `NeweggHttpGate` bounds
 *     in-flight requests and spaces consecutive starts. On a 429 it multiplicatively
 *     backs off (halves concurrency, doubles spacing); on sustained success it
 *     additively probes faster. This auto-discovers the rate Newegg actually
 *     tolerates from the current IP(s) instead of guessing a fixed value.
 */
export async function fetchNeweggHtml(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  return httpGate.run(() => doFetch(url, signal));
}

// --- Proxy pool ---------------------------------------------------------------

interface ProxyEntry {
  url: string;
  /** Don't reuse this proxy until this absolute time (ms epoch). */
  coolingUntil: number;
}

const proxies: ProxyEntry[] = (process.env.NEWEGG_PROXIES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((url) => ({ url, coolingUntil: 0 }));

let proxyCursor = 0;
const proxyAgents = new Map<string, ProxyAgent>();

/** Pick the next available (non-cooling) proxy round-robin, or null for direct. */
function pickProxy(): ProxyEntry | null {
  if (proxies.length === 0) return null;
  const now = Date.now();
  for (let i = 0; i < proxies.length; i++) {
    const p = proxies[proxyCursor++ % proxies.length]!;
    if (p.coolingUntil <= now) return p;
  }
  return null; // all cooling
}

function dispatcherFor(proxy: ProxyEntry | null): Dispatcher | undefined {
  if (!proxy) return undefined;
  let a = proxyAgents.get(proxy.url);
  if (!a) {
    a = new ProxyAgent({ uri: proxy.url });
    proxyAgents.set(proxy.url, a);
  }
  return a;
}

async function rawFetch(url: string, signal: AbortSignal | undefined, proxy: ProxyEntry | null): Promise<Response> {
  // Per-request hard timeout so a hung/dead proxy can't stall the poller. We
  // combine the caller's signal with a deadline so either aborts the fetch.
  const timeoutMs = envInt("NEWEGG_REQUEST_TIMEOUT_MS", 6_000);
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  const combined = AbortSignal.any(signals);
  const res = (await undiciFetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.newegg.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
    signal: combined,
    dispatcher: dispatcherFor(proxy),
  })) as unknown as Response;
  return res;
}

/**
 * Fetch with proxy rotation. With proxies: ANY error on a proxy (429, network
 * timeout, connection reset) cools that IP off and retries on the next one, so
 * a single blocked or dead IP no longer stalls the poller — it just rotates.
 * Without proxies: a 429 surfaces as a RateLimitError so the gate backs off.
 */
async function doFetch(url: string, signal?: AbortSignal): Promise<string> {
  if (proxies.length === 0) {
    const res = await rawFetch(url, signal, null);
    return handleResponse(res, url, null);
  }
  // Fast path: try DIRECT first (no proxy). From a cloud runner this is ~2-3s and
  // usually not blocked; only if it 403/429/network-errors do we pay the cost
  // of a slow proxy hop. This is what gets a 6-watch poll under ~4s.
  try {
    const res = await rawFetch(url, signal, null);
    return await handleResponse(res, url, null);
  } catch {
    // direct blocked / failed → fall through to proxy rotation
  }
  let lastErr: unknown = null;
  // Fail fast: don't try every proxy per request (that can take proxies×timeout
  // when the whole pool is dead, stalling the poller for minutes). Try at most
  // MAX_ROTATION, then surface the error so the tick completes quickly.
  const maxRotation = envInt("NEWEGG_MAX_PROXY_ROTATION", 2);
  const attempts = Math.min(proxies.length, Math.max(1, maxRotation));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const proxy = pickProxy();
    if (!proxy) break; // every proxy is cooling down
    try {
      const res = await rawFetch(url, signal, proxy);
      return handleResponse(res, url, proxy);
    } catch (err) {
      lastErr = err;
      if (err instanceof RateLimitError) {
        // Rate limit: cool this IP for the full Retry-After window.
        const cool = err.retryAfterMs ?? 60_000;
        proxy.coolingUntil = Date.now() + cool;
        console.warn(`[newegg] proxy ${proxy.url} rate-limited; rotating (cooling ${cool / 1000}s)`);
      } else {
        // Network error / timeout: briefly cool this proxy and rotate to the
        // next one — it's likely dead or too slow to be usable right now.
        proxy.coolingUntil = Date.now() + 30_000;
        console.warn(`[newegg] proxy ${proxy.url} failed (${(err as Error)?.name ?? "error"}); rotating`);
      }
      continue;
    }
  }
  if (lastErr instanceof RateLimitError) throw lastErr;
  throw lastErr ?? new RateLimitError({ status: 429, url });
}

async function handleResponse(res: Response, url: string, proxy: ProxyEntry | null): Promise<string> {
  if (res.ok) return res.text();
  if (res.status === 429 || res.status === 503) {
    throw new RateLimitError({
      status: res.status,
      retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
      url,
    });
  }
  const via = proxy ? ` via ${proxy.url}` : "";
  throw new Error(`newegg HTTP ${res.status} for ${url}${via}`);
}

/** Parse an HTTP `Retry-After` header (seconds or HTTP-date) into ms. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number.parseInt(value, 10);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

// --- Adaptive concurrency gate (AIMD) ----------------------------------------

interface GateConfig {
  startConcurrency: number;
  maxConcurrency: number;
  minConcurrency: number;
  startSpacingMs: number;
  minSpacingMs: number;
  maxSpacingMs: number;
}

/**
 * Process-wide Newegg request gate. Bounds in-flight requests AND spaces
 * consecutive starts. Uses AIMD (additive-increase / multiplicative-decrease,
 * the same idea as TCP congestion control) to auto-discover the request rate
 * Newegg tolerates from the current IP: on a 429 it halves concurrency and
 * doubles spacing; after a run of successes it cautiously probes faster.
 */
class NeweggHttpGate {
  private active = 0;
  private lastStart = 0;
  private queue: Array<() => void> = [];
  private scheduled = false;
  private concurrency: number;
  private spacingMs: number;
  private consecutiveSuccesses = 0;

  constructor(private readonly cfg: GateConfig) {
    this.concurrency = cfg.startConcurrency;
    this.spacingMs = cfg.startSpacingMs;
  }

  /** Current effective settings (for diagnostics / the UI). */
  get state() {
    return { concurrency: this.concurrency, spacingMs: this.spacingMs };
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        this.active++;
        this.lastStart = Date.now();
        fn().then(
          (v) => {
            this.onSuccess();
            resolve(v);
          },
          (e) => {
            if (e instanceof RateLimitError) this.onRateLimit(e);
            else this.consecutiveSuccesses = 0;
            reject(e);
          },
        ).finally(() => {
          this.active--;
          this.pump();
        });
      });
      this.pump();
    });
  }

  private onSuccess(): void {
    this.consecutiveSuccesses++;
    // Additive increase: after a run of clean successes, cautiously probe a
    // higher rate (one more concurrent slot, slightly tighter spacing).
    if (this.consecutiveSuccesses >= 8 && this.concurrency < this.cfg.maxConcurrency) {
      this.concurrency = Math.min(this.concurrency + 1, this.cfg.maxConcurrency);
      this.spacingMs = Math.max(this.cfg.minSpacingMs, Math.round(this.spacingMs * 0.8));
      this.consecutiveSuccesses = 0;
      console.log(
        `[newegg-gate] probing up: concurrency=${this.concurrency} spacing=${this.spacingMs}ms`,
      );
    }
  }

  private onRateLimit(_err: RateLimitError): void {
    this.consecutiveSuccesses = 0;
    // Multiplicative decrease: back off hard when Newegg pushes back.
    const prevC = this.concurrency;
    this.concurrency = Math.max(this.cfg.minConcurrency, Math.floor(this.concurrency / 2));
    this.spacingMs = Math.min(this.cfg.maxSpacingMs, this.spacingMs * 2);
    if (this.concurrency !== prevC) {
      console.log(
        `[newegg-gate] backing off: concurrency ${prevC}->${this.concurrency} spacing=${this.spacingMs}ms`,
      );
    }
  }

  private pump(): void {
    if (this.scheduled) return;
    while (this.active < this.concurrency && this.queue.length > 0) {
      const now = Date.now();
      const wait =
        this.lastStart > 0 ? Math.max(0, this.lastStart + this.spacingMs - now) : 0;
      if (wait > 0) {
        this.scheduled = true;
        setTimeout(() => {
          this.scheduled = false;
          this.pump();
        }, wait);
        return;
      }
      const job = this.queue.shift()!;
      job();
    }
  }
}

// With proxies, each request egresses a different IP, so we can safely fire
// many Newegg requests at once (no shared-IP rate-limit risk). Without
// proxies, stay polite (low concurrency, wider spacing) from one IP.
const _hasProxies = proxies.length > 0;
const httpGate = new NeweggHttpGate({
  startConcurrency: envInt("NEWEGG_MAX_CONCURRENCY", _hasProxies ? 6 : 2),
  maxConcurrency: envInt("NEWEGG_MAX_CONCURRENCY_CEILING", 6),
  minConcurrency: 1,
  startSpacingMs: envInt("NEWEGG_MIN_SPACING_MS", _hasProxies ? 200 : 800),
  minSpacingMs: envInt("NEWEGG_MIN_SPACING_MS_FLOOR", 300),
  maxSpacingMs: 2500,
});

/** Current gate settings (concurrency / spacing the AIMD controller settled on). */
export function getNeweggGateState(): { concurrency: number; spacingMs: number } {
  return httpGate.state;
}
