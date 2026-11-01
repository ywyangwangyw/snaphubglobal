import { eq, sql } from "drizzle-orm";

import { getDb, products, watches, snapshots, pollerHeartbeat, pollMetrics } from "@stockwatch/db";

import { listingCondition } from "./condition";
import { buildCatalog, type CatalogProduct } from "./catalog";

import {
  type ProductView,
  type PollerStatus,
  type WatchView,
} from "./demo";
import { fetchLiveProducts, getPollStats, type PollStats, type ModelPollStatus, type CoverageCell, type PollMetrics, type MetricRow, type WatchQueueItem, EMPTY_METRICS } from "./live";
import { neonQuery } from "./neon-query";

export const isDemo = !process.env.DATABASE_URL;

function getIsDemo() {
  return !process.env.DATABASE_URL;
}

/**
 * Foreign-currency → USD exchange rates. Convention: `rates[CUR]` = how many
 * `CUR` one USD buys (e.g. `EUR: 0.92` ⇒ 1 USD = €0.92 ⇒ USD = EUR / 0.92).
 * Fetched from Frankfurter (free, no API key, ECB daily rates) with a 1h
 * in-memory cache and a hardcoded fallback so the UI never breaks if the FX
 * service is down. The dashboard converts every listing's price to USD so
 * cross-country comparison is apples-to-apples, and shows the rates in a
 * reference section at the top.
 */
const FALLBACK_RATES: Record<string, number> = { EUR: 0.92, GBP: 0.79, CAD: 1.36 };

export interface UsdRates {
  rates: Record<string, number>;
  asOf: string;
}

let _ratesCache: UsdRates | null = null;
let _ratesAt = 0;
const RATES_TTL_MS = 3600_000;

export async function getUsdRates(): Promise<UsdRates> {
  const now = Date.now();
  if (_ratesCache && now - _ratesAt < RATES_TTL_MS) return _ratesCache;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch("https://api.frankfurter.app/latest?from=USD", {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { date: string; rates: Record<string, number> };
    const rates: Record<string, number> = { ...FALLBACK_RATES, ...j.rates };
    _ratesCache = { rates, asOf: j.date };
    _ratesAt = now;
    return _ratesCache;
  } catch (err) {
    console.warn("[data] FX fetch failed, using fallback rates:", (err as Error).message);
    _ratesCache = { rates: FALLBACK_RATES, asOf: new Date().toISOString().slice(0, 10) };
    _ratesAt = now;
    return _ratesCache;
  }
}

/** Load products + their latest snapshot per watch, plus poller heartbeat,
 *  and the derived catalog (retailer-id catalog items grouped into products). */
export async function loadData(): Promise<{
  products: ProductView[];
  poller: PollerStatus;
  stats: PollStats | null;
  rates: UsdRates;
  catalog: CatalogProduct[];
}> {
  const rates = await getUsdRates();
  if (getIsDemo()) {
    // Live mode: fetch REAL Newegg RTX 50-series first-party listings (cached).
    const { products, poller } = await fetchLiveProducts();
    return { products, poller, stats: getPollStats(), rates, catalog: buildCatalog(products, rates) };
  }
  // Race the DB load against a timeout. Over a high-latency link to Neon
  // the read queries take ~5-10s through the HTTP driver (see neon-query.ts)
  // depending on network conditions + ~1s for the FX rates fetch, so 20s
  // gives comfortable headroom while still bounding the wait. Only a truly
  // unreachable DB falls back to live.
  const DB_TIMEOUT_MS = 20_000;
  try {
    const result = await Promise.race([
      loadFromDb(rates),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("DB query timed out — falling back to live mode")),
          DB_TIMEOUT_MS,
        ),
      ),
    ]);
    const { rawTitles, ...rest } = result;
    return { ...rest, catalog: buildCatalog(rest.products, rates, rawTitles) };
  } catch (err) {
    // The DB can be unreachable (Neon quota exceeded, cold-start drop) or
    // too slow (throttled). Fall back to live mode so the page ALWAYS
    // renders — the SSE stream still surfaces real listings — rather than
    // throwing a 500 or hanging for minutes.
    console.warn(
      "[data] DB query failed — falling back to live mode:",
      err instanceof Error ? err.message : err,
    );
    const { products, poller } = await fetchLiveProducts();
    return { products, poller, stats: getPollStats(), rates, catalog: buildCatalog(products, rates) };
  }
}

/** DB-backed load. Called by loadData when DATABASE_URL is set; any error
 *  (e.g. Neon quota exceeded) is caught by the caller, which falls back to
 * live mode so the page always renders. */
async function loadFromDb(rates: UsdRates): Promise<{
  products: ProductView[];
  poller: PollerStatus;
  stats: PollStats | null;
  rates: UsdRates;
  /** Raw retailer title per listing (WatchView.watchId) for catalog matching. */
  rawTitles: Map<string, string>;
}> {
  // All read queries go through Neon's HTTP driver (see neon-query.ts) and run
  // in PARALLEL — over a high-latency link to Neon, postgres-js's TCP+TLS
  // transfers multi-row results ~10x slower (the ~1100-row snapshots query
  // alone takes 24-34s via postgres-js vs ~4.6s via Neon HTTP). Running all
  // eight queries (5 main + 3 poll-metrics) concurrently through HTTP keeps
  // the whole load under ~10s, well inside the DB timeout, so the dashboard
  // stays in DB mode (per-country listings, coverage matrix, per-MPN images
  // from every retailer) instead of falling back to Newegg-only live mode.
  const nq = <T>(s: TemplateStringsArray, ...v: unknown[]) => neonQuery<T>(s as any, ...v);

  const [productRows, latest, watchRowsRaw, beat, watchCounts, pollMetrics, queueRows] = await Promise.all([
    nq<{ id: string; name: string; mpn: string | null; image_url: string | null }>`
      SELECT id, name, mpn, image_url FROM products ORDER BY name
    `,
    (async () => {
      // Latest snapshot PER listing (watch × retailer SKU). `mpn` holds the
      // retailer SKU, so (watch_id, mpn) uniquely identifies one listing's
      // series. DISTINCT ON keeps the newest row per listing. Aggregated
      // into a SINGLE JSON row so the ~1100-row result crosses the
      // high-latency link as one ~200KB message, not 1100 messages.
      const rows = await nq<{ data: string }>`
        SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)::text AS data
        FROM (
          SELECT DISTINCT ON (watch_id, mpn)
            watch_id, product_id, retailer, country, category, in_stock, status, price,
            original_price, discount_amount, title, canonical_title,
            mpn, image_url, url, seller, created_at,
            coalesce(last_seen_at, created_at) AS seen_at,
            raw->>'currency' AS currency,
            raw->>'condition' AS condition
          FROM snapshots
          WHERE mpn IS NOT NULL AND mpn <> ''
          ORDER BY watch_id, mpn, created_at DESC
        ) t
      `;
      return JSON.parse(rows[0]?.data ?? "[]") as Array<{
        watch_id: string;
        product_id: string;
        retailer: string;
        country: string;
        category: string | null;
        in_stock: boolean;
        status: string;
        price: string | null;
        original_price: string | null;
        discount_amount: string | null;
        title: string | null;
        canonical_title: string | null;
        mpn: string | null;
        image_url: string | null;
        url: string | null;
        seller: string | null;
        created_at: string;
        seen_at: string;
        currency: string | null;
        condition: string | null;
      }>;
    })(),
    nq<{ id: string; product_id: string; retailer: string; country: string; query: string; poll_interval_sec: number; enabled: boolean; options: Record<string, unknown> | null }>`
      SELECT id, product_id, retailer, country, query, poll_interval_sec, enabled, options
      FROM watches WHERE enabled = true
    `,
    nq<{ id: string; last_beat_at: string; watch_count: number; retailer_count: number; poll_cycle_sec: number }>`
      SELECT id, last_beat_at, watch_count, retailer_count, poll_cycle_sec
      FROM poller_heartbeat WHERE id = 'singleton' LIMIT 1
    `,
    nq<{ retailer: string; country: string; enabled: boolean; n: number }>`
      SELECT retailer, country, enabled, count(*)::int AS n
      FROM watches GROUP BY retailer, country, enabled
    `,
    // Run poll_metrics queries IN PARALLEL with the main queries (not after)
    // so all 8 queries share one round-trip window instead of 5+3 sequential.
    buildPollMetrics(),
    // Per-watch schedule (last poll + next due) for the Polling tab's queue.
    // Needs the heartbeat's cycle for search watches; resolved after the
    // Promise.all below from `beat`, so fetch the raw rows here.
    loadWatchQueueRows(),
  ]);

  // Map snake_case watch rows → camelCase shape expected by buildDbStats.
  const watchRows = watchRowsRaw.map((w) => ({
    id: w.id,
    productId: w.product_id,
    retailer: w.retailer,
    country: w.country,
    query: w.query,
    pollIntervalSec: w.poll_interval_sec,
    firstPartyOnly: Boolean(w.options?.firstPartyOnly),
  }));

  // Group latest snapshots by watch id so each product's watches can map to
  // their (possibly multiple) current listings.
  const listingsByWatch = new Map<string, typeof latest>();
  for (const row of latest) {
    const arr = listingsByWatch.get(row.watch_id) ?? [];
    arr.push(row);
    listingsByWatch.set(row.watch_id, arr);
  }

  const rawTitles = new Map<string, string>();
  const items: ProductView[] = productRows.map((p) => {
    const ws = watchRows.filter((w) => w.productId === p.id);
    const watchViews: WatchView[] = [];
    for (const w of ws) {
      const isFirstPartyOnly =
        w.firstPartyOnly ||
        w.retailer === "bestbuy" ||
        w.retailer === "msi" ||
        w.retailer === "ldlc" ||
        (w.retailer === "newegg" && !w.query.toLowerCase().includes("desktop"));

      const snaps = listingsByWatch.get(w.id) ?? [];
      for (const snap of snaps) {
        // Drop third-party marketplace sellers from first-party watches
        if (isFirstPartyOnly) {
          const seller = (snap.seller ?? "").trim();
          const is3rdParty =
            seller !== "" &&
            seller !== "Amazon" &&
            seller !== "MSI" &&
            seller !== "Best Buy" &&
            seller !== "LDLC" &&
            seller !== "Newegg";
          const isMarketplaceItem =
            snap.retailer === "newegg" &&
            (Boolean(snap.url && /\/p\/(9SI|1FT)/i.test(snap.url)) ||
             Boolean(snap.mpn && /^(9SI|1FT)/i.test(snap.mpn)));
          if (is3rdParty || isMarketplaceItem) continue;
        }

        // Drop accessory cases/coolers that got misrouted under GPU products
        if (
          snap.category === "gpu" &&
          /\b(case|chassis|cooler|waterblock|fan kit)\b/i.test(snap.title ?? "") &&
          !/\b(graphics card|geforce|radeon)\b/i.test(snap.title ?? "")
        ) {
          continue;
        }

        const condition = listingCondition(snap);

        // Per-listing display id: <watchId>/<sku> — unique + stable so the
        // SSE upsert can match the same listing across polls.
        const listingKey = snap.mpn ? `${w.id}/${snap.mpn}` : w.id;
        if (snap.title) rawTitles.set(listingKey, snap.title);
        watchViews.push({
          watchId: listingKey,
          retailer: w.retailer,
          country: snap.country ?? w.country ?? "US",
          category: (snap.category ?? "gpu") as WatchView["category"],
          condition,
          query: w.query,
          pollIntervalSec: w.pollIntervalSec,
          inStock: snap.in_stock,
          status: (snap.status ?? "unknown") as WatchView["status"],
          price: snap.price ?? null,
          originalPrice: snap.original_price ?? null,
          discountAmount: snap.discount_amount ?? null,
          title: snap.canonical_title ?? snap.title ?? null,
          url: snap.url ?? null,
          seller: snap.seller ?? null,
          mpn: snap.mpn ?? null,
          imageUrl: snap.image_url ?? null,
          currency: snap.currency ?? null,
          // Last time the poller confirmed this state (unchanged polls touch
          // last_seen_at without writing a row), not when the row was written.
          updatedAt: snap.seen_at ?? snap.created_at ?? null,
        });
      }
    }
    return {
      id: p.id,
      name: p.name,
      mpn: p.mpn,
      imageUrl: p.image_url,
      watches: watchViews,
    };
  });

  const lastIso = beat[0]?.last_beat_at ?? null;
  const ageMs = lastIso ? Date.now() - new Date(lastIso).getTime() : Infinity;
  // The poller's expected beat cadence (cron=3600s hourly, daemon≈60s). We
  // tolerate up to 1.5× the cycle before flagging "down" — so an hourly GitHub
  // Actions cron poller (one beat per run) stays green between runs, and only
  // goes red if a whole scheduled run is missed. Floor at 90s so a daemon
  // poller that stops beating is still caught quickly.
  const cycleSec = beat[0]?.poll_cycle_sec ?? 3600;
  const aliveThresholdMs = Math.max(90_000, Math.round(cycleSec * 1500));
  const alive = ageMs < aliveThresholdMs;

  const poller: PollerStatus = {
    alive,
    lastBeatAt: lastIso,
    watchCount: beat[0]?.watch_count ?? 0,
    retailerCount: beat[0]?.retailer_count ?? 0,
    pollCycleSec: cycleSec,
  };

  // Per-(retailer, country) coverage matrix for the Polling tab. Includes
  // DISABLED watches so unreachable storefronts (e.g. Akamai-gated Newegg CA,
  // non-existent MSI CA) show up as "off" instead of silently disappearing.
  // Current first-party listing count per (retailer, country) from the
  // latest-per-listing snapshot rows already fetched above.
  const listingsByRc = new Map<string, number>();
  for (const row of latest) {
    const key = `${row.retailer}|${row.country}`;
    listingsByRc.set(key, (listingsByRc.get(key) ?? 0) + 1);
  }
  const coverageMap = new Map<string, CoverageCell>();
  for (const w of watchCounts) {
    const key = `${w.retailer}|${w.country}`;
    const cell = coverageMap.get(key) ?? {
      retailer: w.retailer,
      country: w.country,
      enabledWatches: 0,
      totalWatches: 0,
      listingCount: listingsByRc.get(key) ?? 0,
    };
    cell.totalWatches += w.n;
    if (w.enabled) cell.enabledWatches += w.n;
    coverageMap.set(key, cell);
  }
  const coverage: CoverageCell[] = [...coverageMap.values()].sort(
    (a, b) => a.retailer.localeCompare(b.retailer) || a.country.localeCompare(b.country),
  );

  const stats = buildDbStats(
    items,
    watchRows,
    lastIso,
    coverage,
    pollMetrics,
    poller.pollCycleSec,
    buildWatchQueue(queueRows, cycleSec),
  );

  return { products: items, poller, stats, rates, rawTitles };
}

/** Raw per-watch schedule rows: every watch (disabled ones too, so admins can
 *  re-enable them from the Polling tab) joined to its MOST RECENT poll_metrics
 *  row. Two cheap queries through Neon HTTP (watches is ~75 rows; the
 *  latest-per-watch scan is bounded to 7 days via the created_at index). */
async function loadWatchQueueRows(): Promise<QueueRow[]> {
  const nq = <T>(s: TemplateStringsArray, ...v: unknown[]) => neonQuery<T>(s as any, ...v);
  const rows = await nq<QueueRow>`
    SELECT w.id AS watch_id, w.product_id, p.name AS product_name, w.retailer, w.country,
           w.query, w.poll_interval_sec, w.options, w.enabled,
           m.status AS last_status, m.error AS last_error, m.duration_ms AS last_duration_ms,
           m.listings AS last_listings, m.routed AS last_routed, m.created_at AS last_poll_at,
           d.p50_ms AS p50_duration_ms, d.polls_24h
    FROM watches w
    JOIN products p ON p.id = w.product_id
    LEFT JOIN LATERAL (
      SELECT status, error, duration_ms, listings, routed, created_at
      FROM poll_metrics pm
      WHERE pm.watch_id = w.id AND pm.created_at > now() - interval '7 days'
      ORDER BY created_at DESC
      LIMIT 1
    ) m ON true
    LEFT JOIN LATERAL (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50_ms,
             count(*)::int AS polls_24h
      FROM poll_metrics pm
      WHERE pm.watch_id = w.id AND pm.created_at > now() - interval '24 hours'
    ) d ON true
    ORDER BY w.retailer, w.country, w.query
  `;
  return rows;
}

interface QueueRow {
  watch_id: string;
  product_id: string;
  product_name: string;
  retailer: string;
  country: string;
  query: string;
  poll_interval_sec: number;
  options: Record<string, unknown> | null;
  enabled: boolean;
  last_status: string | null;
  last_error: string | null;
  last_duration_ms: number | null;
  last_listings: number | null;
  last_routed: number | null;
  last_poll_at: string | null;
  p50_duration_ms: number | null;
  polls_24h: number | null;
}

/** Shape queue rows into `WatchQueueItem`s. `pollCycleSec` is the primary
 *  poller's beat cadence (3600 for the hourly cron). Intervals below it run in
 *  the fast daemon on their own cadence; at or above it the watch rides the
 *  cron, which skips not-yet-due watches, so the effective interval rounds up
 *  to a whole number of cycles. */
function buildWatchQueue(rows: QueueRow[], pollCycleSec: number): WatchQueueItem[] {
  return rows.map((r) => {
    const mode: WatchQueueItem["mode"] =
      r.options?.mode === "product" || /^https?:\/\//i.test(r.query) ? "product" : "search";
    const sec = r.poll_interval_sec;
    const effective = mode === "product" || sec < pollCycleSec ? sec : Math.ceil(sec / pollCycleSec) * pollCycleSec;
    const last = r.last_poll_at ? toIso(r.last_poll_at) : null;
    return {
      watchId: r.watch_id,
      productId: r.product_id,
      productName: r.product_name,
      retailer: r.retailer,
      country: r.country,
      query: r.query,
      mode,
      enabled: r.enabled,
      pollIntervalSec: r.poll_interval_sec,
      effectiveIntervalSec: effective,
      lastPollAt: last,
      lastStatus: (r.last_status as WatchQueueItem["lastStatus"]) ?? null,
      lastError: r.last_error ?? null,
      lastDurationMs: r.last_duration_ms ?? null,
      p50DurationMs: r.p50_duration_ms ?? null,
      polls24h: r.polls_24h ?? 0,
      lastListings: r.last_listings ?? null,
      lastRouted: r.last_routed ?? null,
      // A disabled watch is never due.
      nextDueAt: r.enabled && last ? new Date(new Date(last).getTime() + effective * 1000).toISOString() : null,
    };
  });
}

/** Fresh queue for the SSE stream's periodic `queue` event (DB mode). */
export async function loadWatchQueue(): Promise<WatchQueueItem[]> {
  const nq = <T>(s: TemplateStringsArray, ...v: unknown[]) => neonQuery<T>(s as any, ...v);
  const [rows, beat] = await Promise.all([
    loadWatchQueueRows(),
    nq<{ poll_cycle_sec: number }>`SELECT poll_cycle_sec FROM poller_heartbeat WHERE id = 'singleton' LIMIT 1`,
  ]);
  return buildWatchQueue(rows, beat[0]?.poll_cycle_sec ?? 3600);
}

/** Query `poll_metrics` for the last 24h and roll up per-(retailer, country)
 *  latency + success rate, plus an overall line. Returns EMPTY_METRICS on any
 *  DB error so the Polling tab degrades gracefully (no analytics) instead of
 *  breaking the whole page. */
async function buildPollMetrics(): Promise<PollMetrics> {
  const WINDOW_SEC = 86_400; // last 24h
  try {
    // All three poll_metrics queries run in parallel through Neon HTTP
    // (see neon-query.ts) for the same high-latency reason as loadFromDb.
    const nq = <T>(s: TemplateStringsArray, ...v: unknown[]) => neonQuery<T>(s as any, ...v);
    const [agg, latest, overall] = await Promise.all([
      nq<{
        retailer: string; country: string; polls: number; ok: number; rate_limited: number;
        errors: number; p50: number; p95: number; avg_listings: number;
        total_listings: number; last_poll_at: string | null;
      }>`
        SELECT retailer, country,
          count(*)::int AS polls,
          count(*) FILTER (WHERE status IN ('ok','empty'))::int AS ok,
          count(*) FILTER (WHERE status = 'rate_limited')::int AS rate_limited,
          count(*) FILTER (WHERE status = 'error')::int AS errors,
          COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms), 0)::float AS p50,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::float AS p95,
          COALESCE(avg(listings), 0)::float AS avg_listings,
          COALESCE(sum(listings), 0)::int AS total_listings,
          max(created_at) AS last_poll_at
        FROM poll_metrics
        WHERE created_at > now() - (${WINDOW_SEC} || ' seconds')::interval
        GROUP BY retailer, country
        ORDER BY retailer, country
      `,
      nq<{ retailer: string; country: string; status: string; error: string | null; created_at: string }>`
        SELECT DISTINCT ON (retailer, country) retailer, country, status, error, created_at
        FROM poll_metrics
        WHERE created_at > now() - (${WINDOW_SEC} || ' seconds')::interval
        ORDER BY retailer, country, created_at DESC
      `,
      nq<{ total_polls: number; ok: number; p50: number; p95: number }>`
        SELECT
          count(*)::int AS total_polls,
          count(*) FILTER (WHERE status IN ('ok','empty'))::int AS ok,
          COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms), 0)::float AS p50,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::float AS p95
        FROM poll_metrics
        WHERE created_at > now() - (${WINDOW_SEC} || ' seconds')::interval
      `,
    ]);
    const latestMap = new Map<string, (typeof latest)[number]>();
    for (const r of latest) latestMap.set(`${r.retailer}|${r.country}`, r);

    const rows: MetricRow[] = agg.map((r) => {
      const last = latestMap.get(`${r.retailer}|${r.country}`);
      const successRate = r.polls > 0 ? r.ok / r.polls : 0;
      return {
        retailer: r.retailer,
        country: r.country,
        polls: r.polls,
        ok: r.ok,
        rateLimited: r.rate_limited,
        errors: r.errors,
        successRate,
        p50Ms: Math.round(r.p50),
        p95Ms: Math.round(r.p95),
        avgListings: Math.round(r.avg_listings * 10) / 10,
        totalListings: r.total_listings,
        lastPollAt: r.last_poll_at ? toIso(r.last_poll_at) : null,
        lastStatus: (last?.status as MetricRow["lastStatus"]) ?? null,
        lastError: last?.error ?? null,
      };
    });

    const o = overall[0];
    const totalPolls = o?.total_polls ?? 0;
    const okTotal = o?.ok ?? 0;
    return {
      windowSec: WINDOW_SEC,
      totalPolls,
      overallSuccessRate: totalPolls > 0 ? okTotal / totalPolls : 0,
      overallP50Ms: Math.round(o?.p50 ?? 0),
      overallP95Ms: Math.round(o?.p95 ?? 0),
      rows,
    };
  } catch (err) {
    console.warn("[data] buildPollMetrics failed:", (err as Error).message);
    return EMPTY_METRICS;
  }
}

function toIso(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}

/** Build a PollStats-shaped object from the DB so the Polling tab is populated
 *  in DB mode (where there's no in-process adapter gate to read live stats from).
 *  Derives per-model state + listing counts from the latest snapshots, and
 *  poll cadence from the heartbeat + watch intervals. */
export function buildDbStats(
  productViews: ProductView[],
  watchRows: Array<{ id: string; productId: string; retailer: string; query: string; pollIntervalSec: number }>,
  lastBeatIso: string | null,
  coverage: CoverageCell[] = [],
  metrics: PollMetrics = EMPTY_METRICS,
  pollCycleSec = 3600,
  queue: WatchQueueItem[] = [],
): PollStats {
  const watchByProduct = new Map<string, typeof watchRows>();
  for (const w of watchRows) {
    const arr = watchByProduct.get(w.productId) ?? [];
    arr.push(w);
    watchByProduct.set(w.productId, arr);
  }

  const perModel: ModelPollStatus[] = productViews.map((p) => {
    const ws = watchByProduct.get(p.id) ?? [];
    const listingCount = p.watches.filter((w) => w.mpn != null).length;
    const hasSnapshot = p.watches.some((w) => w.updatedAt != null);
    const state: ModelPollStatus["state"] = !hasSnapshot
      ? "polling"
      : listingCount > 0
        ? "ok"
        : "empty";
    return {
      id: p.id,
      name: p.name,
      query: ws[0]?.query ?? "",
      state,
      listingCount,
      lastError: null,
    };
  });

  const okCount = perModel.filter((m) => m.state === "ok").length;

  // Estimate next poll from the poller's actual beat cadence (cron=hourly,
  // daemon≈60s), NOT the shortest per-watch interval (which is 60s for MSI
  // UK and would make "next poll" always read 0s/overdue). Negative/zero means
  // overdue.
  let nextPollInSec: number | null = null;
  if (lastBeatIso) {
    const nextAt = new Date(lastBeatIso).getTime() + pollCycleSec * 1000;
    nextPollInSec = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
  }

  return {
    totalSearches: watchRows.length,
    successCount: okCount,
    failCount: 0,
    rateLimitedCount: 0,
    lastPollAt: lastBeatIso,
    lastError: null,
    backoffUntil: null,
    pollIntervalSec: pollCycleSec,
    nextPollInSec,
    gateConcurrency: Number(process.env.NEWEGG_MAX_CONCURRENCY ?? 2),
    gateSpacingMs: Number(process.env.NEWEGG_MIN_SPACING_MS ?? 800),
    proxyCount: (process.env.NEWEGG_PROXIES ?? "").split(",").filter(Boolean).length,
    perModel,
    coverage,
    metrics,
    queue,
  };
}

export { sql };
