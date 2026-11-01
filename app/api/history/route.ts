import { sql } from "drizzle-orm";

import { getDb, watches, snapshots } from "@stockwatch/db";

export const dynamic = "force-dynamic";

interface Series {
  watchId: string;
  title: string;
  points: { t: string; price: number | null; inStock: boolean }[];
}

/**
 * Historic time-series for a product's watches, used to render price + stock
 * charts. Snapshots are append-only and high-frequency (one per poll), so we
 * bucket them in SQL with `date_bin` into ~80 points across the range — this
 * keeps the payload small and the chart readable regardless of how long the
 * poller has been running.
 *
 *   GET /api/history?productId=<id>&range=24h|7d|30d
 */
export async function GET(req: Request) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "no database configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");
  if (!productId) return Response.json({ error: "productId required" }, { status: 400 });

  const range = url.searchParams.get("range") ?? "7d";
  const rangeMs: Record<string, number> = {
    "24h": 24 * 3600_000,
    "7d": 7 * 24 * 3600_000,
    "30d": 30 * 24 * 3600_000,
  };
  const ms = rangeMs[range] ?? rangeMs["7d"]!;
  const start = new Date(Date.now() - ms);
  const startIso = start.toISOString();
  // ~80 buckets across the range → one row per bucket per watch.
  const intervalMs = Math.max(60_000, Math.round(ms / 80));

  const db = getDb();

  // Resolve watch titles for the product (latest canonical title per watch).
  const watchRows = await db
    .select({ id: watches.id, query: watches.query })
    .from(watches)
    .where(sql`${watches.productId} = ${productId}`);
  const titleById = new Map(watchRows.map((w) => [w.id, w.query]));

  // Latest canonical title per listing (SKU) — used as the series label so
  // each listing's line is named after the actual card, not the search query.
  const listingTitles = (await db.execute(sql`
    SELECT DISTINCT ON (mpn) mpn, canonical_title, title
    FROM ${snapshots}
    WHERE ${snapshots.productId} = ${productId} AND mpn IS NOT NULL
    ORDER BY mpn, created_at DESC
  `)) as unknown as Array<{ mpn: string; canonical_title: string | null; title: string | null }>;
  const listingTitleByMpn = new Map<string, string>();
  for (const r of listingTitles) {
    listingTitleByMpn.set(r.mpn, r.canonical_title ?? r.title ?? r.mpn);
  }

  // Bucketed history PER LISTING (mpn = retailer SKU). DISTINCT ON keeps the
  // newest sample per (listing, bucket) — far cheaper than array_agg + ORDER BY
  // because it can ride the (product_id, mpn, created_at) index directly.
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (mpn, bucket)
      ${snapshots.mpn} AS mpn,
      ${snapshots.watchId} AS watch_id,
      date_bin(make_interval(secs => ${intervalMs}::double precision / 1000), ${snapshots.createdAt}, ${startIso}::timestamptz) AS bucket,
      ${snapshots.price} AS price,
      ${snapshots.inStock} AS in_stock
    FROM ${snapshots}
    WHERE ${snapshots.productId} = ${productId}
      AND ${snapshots.createdAt} >= ${startIso}::timestamptz
      AND ${snapshots.mpn} IS NOT NULL
    ORDER BY mpn, bucket, ${snapshots.createdAt} DESC
  `)) as unknown as Array<{ mpn: string; watch_id: string; bucket: Date | string; price: string | null; in_stock: boolean }>;

  // Group rows into one series per listing (keyed by mpn).
  const byListing = new Map<string, Series>();
  for (const r of rows) {
    const key = r.mpn;
    let s = byListing.get(key);
    if (!s) {
      s = {
        watchId: `${r.watch_id}/${key}`,
        title: listingTitleByMpn.get(key) ?? titleById.get(r.watch_id) ?? key,
        points: [],
      };
      byListing.set(key, s);
    }
    const bucketIso =
      typeof r.bucket === "string" ? r.bucket : new Date(r.bucket as unknown as string).toISOString();
    s.points.push({
      t: bucketIso,
      price: r.price != null ? Number(r.price) : null,
      inStock: r.in_stock,
    });
  }

  return Response.json({
    productId,
    range,
    series: Array.from(byListing.values()),
    summary: computeSummary(rows),
  });
}

/** Lowest / highest / average price across all in-stock samples for the
 *  product over the selected range. Computed server-side from the raw
 * bucketed rows so the chart doesn't have to re-walk every point. */
function computeSummary(
  rows: Array<{ price: string | null; in_stock: boolean }>,
): { lowest: number | null; highest: number | null; average: number | null } {
  const prices: number[] = [];
  for (const r of rows) {
    if (r.in_stock && r.price != null) {
      const p = Number(r.price);
      if (Number.isFinite(p)) prices.push(p);
    }
  }
  if (prices.length === 0) return { lowest: null, highest: null, average: null };
  const sum = prices.reduce((a, b) => a + b, 0);
  return {
    lowest: Math.min(...prices),
    highest: Math.max(...prices),
    average: Math.round((sum / prices.length) * 100) / 100,
  };
}
