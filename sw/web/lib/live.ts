/**
 * Live mode: when no DATABASE_URL is configured, the web app fetches REAL
 * data from the Newegg adapter directly (server-side) instead of showing fake
 * demo data. This makes the dashboard a genuinely running tracker — real
 * RTX 50-series first-party listings, real stock status, real prices, real
 * images — with no database required. When a Neon DB is connected,
 * loadData() uses the poller/DB path instead and this module is never reached.
 */
import { NeweggAdapter, RateLimitError, getNeweggGateState } from "@stockwatch/adapters";
import type { Listing, StockStatus } from "@stockwatch/types";

import type { ProductView, WatchView, PollerStatus } from "./demo";

// The full RTX 50-series lineup tracked by the dashboard in live mode.
// Each model becomes its own ProductView; its listings come from a dedicated
// Newegg search scoped to the GPU category and first-party sellers.
interface GpuModel {
  id: string;
  query: string;
  name: string;
  mpn: string;
  /** Canonical per-product catalog image (Shopify CDN). The poller writes
   *  these to products.image_url in the DB; mirrored here so live mode (used
   *  when Neon is throttled/unavailable) shows real images WITHOUT a DB hit.
   *  Newegg's own CDN (c1.neweggimages.com) 400s on hotlinks, so the
   *  per-listing Newegg image URL is useless client-side. */
  catalogImageUrl: string;
}

const MODELS: readonly GpuModel[] = [
  { id: "live-rtx5060ti", query: "rtx 5060 ti", name: "NVIDIA GeForce RTX 5060 Ti", mpn: "RTX 5060 Ti", catalogImageUrl: "https://cdn.shopify.com/s/files/1/0714/4164/5637/files/1024_2c77e82c-cc52-4a38-a7e6-7efdce0fa3de.png?v=1773830320" },
  { id: "live-rtx5060", query: "rtx 5060", name: "NVIDIA GeForce RTX 5060", mpn: "RTX 5060", catalogImageUrl: "https://cdn.shopify.com/s/files/1/0714/4164/5637/files/1024_926cf655-cc62-4b2f-bb0a-398e73b9b72e.png?v=1772473501" },
  { id: "live-rtx5070", query: "rtx 5070", name: "NVIDIA GeForce RTX 5070", mpn: "RTX 5070", catalogImageUrl: "https://cdn.shopify.com/s/files/1/0629/2111/3820/files/1024_59d1fb00-8918-4d4d-9676-1ed4673da994.png?v=1779279924" },
  { id: "live-rtx5070ti", query: "rtx 5070 ti", name: "NVIDIA GeForce RTX 5070 Ti", mpn: "RTX 5070 Ti", catalogImageUrl: "https://cdn.shopify.com/s/files/1/0629/2111/3820/files/1024_446d2f3d-5b07-4943-9087-bf9e047bc44b.png?v=1784642189" },
  { id: "live-rtx5080", query: "rtx 5080", name: "NVIDIA GeForce RTX 5080", mpn: "RTX 5080", catalogImageUrl: "https://cdn.shopify.com/s/files/1/0714/4164/5637/files/1024_0e643919-6f55-45ca-8989-3054ce13794a.png?v=1773756595" },
  { id: "live-rtx5090", query: "rtx 5090", name: "NVIDIA GeForce RTX 5090", mpn: "RTX 5090", catalogImageUrl: "https://cdn.shopify.com/s/files/1/0714/4164/5637/files/1024_129f3c38-4b5c-43a5-b309-93ecf9d76cb2.png?v=1774009212" },
];

const SEARCH_OPTS = {
  firstPartyOnly: true,
  // Newegg "GPUs / Video Graphics Cards" category — excludes prebuilt desktops.
  categoryN: "100007709",
  maxPages: 1,
  maxResults: 10,
} as const;

// Detail-page enrichment: fetches each listing's product page to surface
// Newegg's hidden instant rebate ("EXTRA DISCOUNT AVAILABLE. UNLOCK IT HERE")
// — the original list price + the $ rebate that yields the real price. Only
// the first `ENRICH_CAP` listings per model are enriched to stay polite
// (Newegg rate-limits aggressive bursts).
const ENRICH_CAP = 4;
const ENRICH_OPTS = {
  ...SEARCH_OPTS,
  enrichDetails: true,
} as const;

/** Per-model outcome of the most recent poll cycle. */
export interface ModelPollStatus {
  id: string;
  name: string;
  query: string;
  /** "ok" = listings returned; "empty" = 0 listings but no error;
   *  "rate_limited" = HTTP 429/503; "error" = other failure;
   *  "polling" = not yet attempted this session. */
  state: "ok" | "empty" | "rate_limited" | "error" | "polling";
  listingCount: number;
  lastError: string | null;
}

/** One cell of the per-(retailer, country) coverage matrix shown on the
 *  Polling tab — makes it visible at a glance which storefront pipelines
 *  are live, which are polling but empty, and which are disabled (e.g. an
 *  Akamai-gated or non-existent storefront we deliberately turned off). */
export interface CoverageCell {
  retailer: string;
  country: string;
  /** Number of ENABLED watches for this (retailer, country). 0 ⇒ disabled. */
  enabledWatches: number;
  /** Total watches (enabled + disabled) for this (retailer, country). */
  totalWatches: number;
  /** Current first-party listings surfaced for this (retailer, country). */
  listingCount: number;
}

/**
 * One watch's place in the poll schedule — the Polling tab's "queue" view.
 * Derived from the watch row + its most recent `poll_metrics` row; the UI
 * computes "due in / overdue" client-side from `nextDueAt` and its clock.
 */
export interface WatchQueueItem {
  watchId: string;
  productId: string;
  productName: string;
  retailer: string;
  country: string;
  /** Search query, or the product-page URL for `mode: "product"` watches. */
  query: string;
  mode: "search" | "product";
  /** `watches.enabled` — the poller skips disabled watches. Disabled watches
   *  are still listed so they can be re-enabled from the Polling tab. */
  enabled: boolean;
  /** The watch's configured interval. */
  pollIntervalSec: number;
  /** Interval the watch is ACTUALLY polled at: product watches run on their
   *  own interval (per-minute fast poller); search watches run once per
   *  poller cycle (hourly cron), so max(pollIntervalSec, pollCycleSec). */
  effectiveIntervalSec: number;
  lastPollAt: string | null;
  lastStatus: "ok" | "empty" | "rate_limited" | "error" | null;
  lastError: string | null;
  lastDurationMs: number | null;
  /** Median poll duration over the last 24h (null if no polls). */
  p50DurationMs: number | null;
  /** Polls recorded in the last 24h. */
  polls24h: number;
  lastListings: number | null;
  lastRouted: number | null;
  /** ISO time the next poll is expected (lastPollAt + effectiveInterval). */
  nextDueAt: string | null;
}

/** Aggregate polling statistics surfaced to the UI. */
export interface PollStats {
  totalSearches: number;
  successCount: number;
  failCount: number;
  rateLimitedCount: number;
  /** ISO timestamp of the last poll cycle's start. */
  lastPollAt: string | null;
  lastError: string | null;
  /** ISO timestamp until which the poller is backing off (null if not). */
  backoffUntil: string | null;
  /** Configured base poll interval (seconds). */
  pollIntervalSec: number;
  /** Seconds until the next poll attempt (negative if overdue). */
  nextPollInSec: number | null;
  /** Effective concurrency the AIMD gate has settled on (auto-tuned). */
  gateConcurrency: number;
  /** Effective min spacing (ms) the AIMD gate has settled on. */
  gateSpacingMs: number;
  /** Number of proxy IPs configured (0 = direct). */
  proxyCount: number;
  perModel: ModelPollStatus[];
  /** Per-(retailer, country) pipeline coverage matrix. */
  coverage: CoverageCell[];
  /** Per-poll performance analytics (latency, success rate) from poll_metrics. */
  metrics: PollMetrics;
  /** Per-watch poll schedule (last poll, status, next due). */
  queue: WatchQueueItem[];
}

/** Performance analytics for one (retailer, country) pipeline over a window. */
export interface MetricRow {
  retailer: string;
  country: string;
  /** Total poll attempts in the window. */
  polls: number;
  /** Polls that completed without a transport error (ok + empty). */
  ok: number;
  rateLimited: number;
  errors: number;
  /** 0..1 share of polls that succeeded. */
  successRate: number;
  /** Median latency (ms). */
  p50Ms: number;
  /** 95th-percentile latency (ms). */
  p95Ms: number;
  /** Mean listings returned per poll. */
  avgListings: number;
  /** Total listings surfaced across all polls in the window. */
  totalListings: number;
  /** ISO timestamp of the most recent poll. */
  lastPollAt: string | null;
  /** Status of the most recent poll. */
  lastStatus: "ok" | "empty" | "rate_limited" | "error" | null;
  lastError: string | null;
}

/** Roll-up of per-poll metrics for the Polling tab's analytics panel. */
export interface PollMetrics {
  /** Lookback window in seconds (e.g. 86400 = last 24h). */
  windowSec: number;
  totalPolls: number;
  overallSuccessRate: number;
  overallP50Ms: number;
  overallP95Ms: number;
  rows: MetricRow[];
}

/** Empty metrics (used before any polls have been recorded). */
export const EMPTY_METRICS: PollMetrics = {
  windowSec: 86_400,
  totalPolls: 0,
  overallSuccessRate: 0,
  overallP50Ms: 0,
  overallP95Ms: 0,
  rows: [],
};

const BASE_POLL_INTERVAL_SEC = 45;
const MAX_BACKOFF_MS = 5 * 60_000;

const stats: PollStats = {
  totalSearches: 0,
  successCount: 0,
  failCount: 0,
  rateLimitedCount: 0,
  lastPollAt: null,
  lastError: null,
  backoffUntil: null,
  pollIntervalSec: BASE_POLL_INTERVAL_SEC,
  nextPollInSec: BASE_POLL_INTERVAL_SEC,
  gateConcurrency: 2,
  gateSpacingMs: 800,
  proxyCount: (process.env.NEWEGG_PROXIES ?? "").split(",").filter(Boolean).length,
  perModel: MODELS.map((m) => ({
    id: m.id, name: m.name, query: m.query, state: "polling", listingCount: 0, lastError: null,
  })),
  // Live mode polls Newegg US directly (no DB), so the only live pipeline is
  // newegg/US. DB mode replaces this with the full per-storefront matrix.
  coverage: [{ retailer: "newegg", country: "US", enabledWatches: MODELS.length, totalWatches: MODELS.length, listingCount: 0 }],
  metrics: EMPTY_METRICS,
  // Live mode has no DB-backed watch rows; the queue view is DB-mode only.
  queue: [],
};

/** Snapshot of the current polling statistics (for the UI / SSE). */
export function getPollStats(): PollStats {
  const now = Date.now();
  let next: number | null;
  if (stats.backoffUntil) {
    const ms = new Date(stats.backoffUntil).getTime() - now;
    next = Math.max(0, Math.round(ms / 1000));
  } else if (stats.lastPollAt) {
    next = Math.max(0, Math.round((new Date(stats.lastPollAt).getTime() + BASE_POLL_INTERVAL_SEC * 1000 - now) / 1000));
  } else {
    next = BASE_POLL_INTERVAL_SEC;
  }
  const gate = getNeweggGateState();
  return {
    ...stats,
    nextPollInSec: next,
    gateConcurrency: gate.concurrency,
    gateSpacingMs: gate.spacingMs,
    perModel: stats.perModel.map((m) => ({ ...m })),
    metrics: stats.metrics,
  };
}

export interface LiveUpdate {
  watchId: string;
  productId: string;
  /** Retailer key (e.g. "newegg"). The DB snapshot SSE path always sends this,
   *  so the live fallback must too — otherwise the dashboard's handler reads
   *  `snap.retailer` as undefined and ListingsModal's sort crashes on
   *  `.localeCompare`. */
  retailer: string;
  country: string;
  category: WatchView["category"];
  condition?: WatchView["condition"];
  currency: string | null;
  inStock: boolean;
  status: StockStatus;
  price: string | null;
  originalPrice: string | null;
  discountAmount: string | null;
  title: string | null;
  mpn: string | null;
  url: string | null;
  imageUrl: string | null;
  /** Per-product catalog image (one canonical image per GPU model). */
  productImageUrl: string | null;
  updatedAt: string;
}

interface Cache {
  products: ProductView[];
  poller: PollerStatus;
  at: number;
}

let cache: Cache | null = null;

function buildWatches(listings: Listing[], query: string, at: number): WatchView[] {
  return listings
    .filter((l) => l.title && l.title.trim() !== "")
    .map((l) => ({
      watchId: `newegg-${l.sku}`,
      retailer: "newegg",
      country: "US",
      category: (l.category ?? "gpu") as WatchView["category"],
      condition: (l.condition as WatchView["condition"]) ?? "new",
      query,
      pollIntervalSec: 45,
      inStock: l.status === "in_stock",
      status: l.status,
      price: l.price != null ? l.price.toFixed(2) : null,
      originalPrice: l.originalPrice != null ? l.originalPrice.toFixed(2) : null,
      discountAmount: l.discountAmount != null ? l.discountAmount.toFixed(2) : null,
      title: l.canonicalTitle || l.title,
      url: l.url,
      seller: l.seller ?? "Newegg",
      mpn: l.sku || null,
      imageUrl: l.imageUrl || null,
      updatedAt: new Date(at).toISOString(),
      currency: "USD",
    }));
}

function buildProduct(model: GpuModel, listings: Listing[], at: number): ProductView {
  // Canonical per-product image: use the model's catalog image (Shopify CDN,
  // mirrors products.image_url in the DB). Do NOT use the per-listing Newegg
  // image URL — c1.neweggimages.com 400s on hotlinks, so it never loads
  // client-side.
  const imageUrl = model.catalogImageUrl;
  return {
    id: model.id,
    name: model.name,
    mpn: model.mpn,
    imageUrl,
    watches: buildWatches(listings, model.query, at),
  };
}

/** Fetch all tracked models, returning per-model listings. Searches run with
 *  limited concurrency (not all at once) to avoid Newegg's rate limiter. Also
 * records per-model outcome + aggregate stats and applies a back-off when the
 * retailer rate-limits us, so the next poll is deferred instead of hammering. */
async function fetchAllModels(enrich = false): Promise<Map<GpuModel, Listing[]>> {
  const adapter = new NeweggAdapter();
  const opts = enrich ? ENRICH_OPTS : SEARCH_OPTS;
  const byModel = new Map<GpuModel, Listing[]>();
  const perModel: ModelPollStatus[] = [];
  let cycleRateLimited = false;
  let cycleRetryAfterMs = 0;
  let cycleError: string | null = null;

  stats.totalSearches += MODELS.length;
  await mapPool(MODELS, 3, async (model) => {
    try {
      const listings = await adapter.search(model.query, opts);
      byModel.set(model, listings);
      stats.successCount++;
      perModel.push({
        id: model.id, name: model.name, query: model.query,
        state: listings.length > 0 ? "ok" : "empty",
        listingCount: listings.length, lastError: null,
      });
    } catch (err) {
      byModel.set(model, []);
      stats.failCount++;
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof RateLimitError) {
        stats.rateLimitedCount++;
        cycleRateLimited = true;
        cycleRetryAfterMs = Math.max(cycleRetryAfterMs, err.retryAfterMs ?? 0);
        cycleError = cycleError ?? `HTTP ${err.status} rate limit`;
        perModel.push({
          id: model.id, name: model.name, query: model.query,
          state: "rate_limited", listingCount: 0, lastError: `HTTP ${err.status}`,
        });
      } else {
        cycleError = cycleError ?? msg;
        perModel.push({
          id: model.id, name: model.name, query: model.query,
          state: "error", listingCount: 0, lastError: msg.slice(0, 140),
        });
      }
      console.error(`[live] search failed for ${model.query}:`, msg);
    }
  });

  stats.lastPollAt = new Date().toISOString();
  stats.lastError = cycleError;
  stats.perModel = perModel;
  // Live mode only polls newegg/US — reflect total listings in its coverage cell.
  const usListings = perModel.reduce((n, m) => n + m.listingCount, 0);
  stats.coverage = [{
    retailer: "newegg",
    country: "US",
    enabledWatches: MODELS.length,
    totalWatches: MODELS.length,
    listingCount: usListings,
  }];

  // Apply / clear a back-off based on this cycle's outcome.
  if (cycleRateLimited) {
    const backoffMs = cycleRetryAfterMs > 0
      ? Math.min(cycleRetryAfterMs, MAX_BACKOFF_MS)
      : Math.min(BASE_POLL_INTERVAL_SEC * 1000 + 30_000, MAX_BACKOFF_MS);
    stats.backoffUntil = new Date(Date.now() + backoffMs).toISOString();
  } else {
    stats.backoffUntil = null;
  }
  return byModel;
}

/** Run an async mapper over `items` with at most `concurrency` in flight. */
async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
}

/** Fetch real Newegg listings. SSR calls this: it returns the cached snapshot
 *  instantly if one exists (the SSE stream keeps it fresh), and otherwise
 *  returns an empty "polling" snapshot immediately (never blocking the page
 *  render on slow proxy fetches). The SSE stream (pollLiveUpdates) does the
 *  actual fetching and populates the cache, so the page fills in progressively. */
export async function fetchLiveProducts(): Promise<{
  products: ProductView[];
  poller: PollerStatus;
}> {
  const now = Date.now();
  if (cache) {
    return { products: cache.products, poller: cache.poller };
  }
  // No cache yet: render instantly with empty products. The SSE stream
  // (pollLiveUpdates) will fetch real data and stream it into the page.
  const poller: PollerStatus = {
    alive: true,
    lastBeatAt: new Date(now).toISOString(),
    watchCount: 0,
    retailerCount: 1,
    pollCycleSec: 3600,
  };
  return { products: MODELS.map((m) => buildProduct(m, [], now)), poller };
}

/** Force a fresh poll and return one update event per listing across all models. */
export async function pollLiveUpdates(): Promise<LiveUpdate[]> {
  // Build a lookup of previously-enriched discount fields keyed by watchId, so
  // the lightweight (non-enriched) poll preserves the original price + rebate
  // that was fetched on the last full load.
  const prevByWatch = new Map<string, { originalPrice: string | null; discountAmount: string | null }>();
  if (cache) {
    for (const p of cache.products) {
      for (const w of p.watches) {
        prevByWatch.set(w.watchId, {
          originalPrice: w.originalPrice,
          discountAmount: w.discountAmount,
        });
      }
    }
  }

  const byModel = await fetchAllModels(false);
  const now = Date.now();
  const products = MODELS.map((m) => buildProduct(m, byModel.get(m) ?? [], now));
  const watchCount = products.reduce((n, p) => n + p.watches.length, 0);
  const poller: PollerStatus = {
    alive: true,
    lastBeatAt: new Date(now).toISOString(),
    watchCount,
    retailerCount: 1,
    pollCycleSec: 3600,
  };
  cache = { products, poller, at: now };

  const updates: LiveUpdate[] = [];
  for (const model of MODELS) {
    const listings = byModel.get(model) ?? [];
    // Canonical per-product image: the model's catalog image (Shopify CDN),
    // NOT the per-listing Newegg URL (which 400s on hotlinks). Sent on every
    // SSE event so the UI's productImageUrl stays populated even when the
    // SSR live poll timed out and returned empty for this model.
    const productImageUrl = model.catalogImageUrl;
    for (const l of listings) {
      if (!l.title || l.title.trim() === "") continue;
      const wid = `newegg-${l.sku}`;
      const prev = prevByWatch.get(wid);
      updates.push({
        watchId: wid,
        productId: model.id,
        retailer: "newegg",
        country: "US",
        category: (l.category ?? "gpu") as WatchView["category"],
        condition: (l.condition as WatchView["condition"]) ?? "new",
        currency: "USD",
        inStock: l.status === "in_stock",
        status: l.status,
        price: l.price != null ? l.price.toFixed(2) : null,
        originalPrice: prev?.originalPrice ?? null,
        discountAmount: prev?.discountAmount ?? null,
        title: l.canonicalTitle || l.title,
        mpn: l.sku || null,
        url: l.url,
        imageUrl: l.imageUrl || null,
        productImageUrl,
        updatedAt: new Date(now).toISOString(),
      });
    }
  }
  return updates;
}
