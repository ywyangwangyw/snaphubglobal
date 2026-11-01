import { index, jsonb, pgTable, text, timestamp, boolean, integer, customType } from "drizzle-orm/pg-core";

/** Drizzle 0.36 has no built-in bytea column — define one. Maps to Postgres
 *  `bytea`; JS values are `Buffer` (postgres-js encodes/decodes natively). */
const bytea = customType<{ data: Buffer; dataType: "bytea" }>({
  dataType() {
    return "bytea";
  },
});

/**
 * stockwatch schema. Three tables:
 *
 * - products:  what you track
 * - watches:   product x retailer x query on a poll interval
 * - snapshots: append-only price/stock history per watch
 */

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    mpn: text("mpn"),
    upc: text("upc"),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_name_idx").on(t.name)],
);

export const watches = pgTable(
  "watches",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    retailer: text("retailer").notNull(),
    /** ISO-ish country code this watch targets (e.g. "US", "UK", "DE"). A
     *  watch is now unique per (product, retailer, country) — Newegg US and
     *  Newegg CA are separate watches hitting different storefronts. */
    country: text("country").notNull().default("US"),
    query: text("query").notNull(),
    pollIntervalSec: integer("poll_interval_sec").notNull().default(300),
    enabled: boolean("enabled").notNull().default(true),
    /** Per-watch adapter options, e.g. {firstPartyOnly:true, categoryN:"100007709", host:"www.newegg.ca"}. */
    options: jsonb("options"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("watches_product_idx").on(t.productId),
    index("watches_retailer_idx").on(t.retailer),
    index("watches_country_idx").on(t.country),
    index("watches_enabled_idx").on(t.enabled),
  ],
);

export const snapshots = pgTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    watchId: text("watch_id")
      .notNull()
      .references(() => watches.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    retailer: text("retailer").notNull(),
    /** Country code of the storefront this listing came from (e.g. "US", "UK"). */
    country: text("country").notNull().default("US"),
    inStock: boolean("in_stock").notNull(),
    status: text("status").notNull(),
    price: text("price"),
    originalPrice: text("original_price"),
    discountAmount: text("discount_amount"),
    shipping: text("shipping"),
    seller: text("seller"),
    title: text("title"),
    canonicalTitle: text("canonical_title"),
    /** Product category: "gpu" (the card) | "accessory" (water block, cooler,
     *  bracket, riser, PSU — a part FOR a card) | "other" (dropped). Set by the
     * poller's router via `classifyListingCategory` so the UI can filter cards
     * from their accessories. */
    category: text("category").notNull().default("gpu"),
    mpn: text("mpn"),
    imageUrl: text("image_url"),
    url: text("url"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Last time the poller observed this exact state (write-on-change dedup
     *  skips the INSERT, so `created_at` alone can't tell "seen an hour ago"
     *  from "not seen for weeks"). Touched on every poll where the listing is
     *  present-but-unchanged; NULL on rows written before the column existed.
     *  Drives the "disappeared from search results → out of stock" pass. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [
    index("snapshots_watch_idx").on(t.watchId),
    index("snapshots_product_idx").on(t.productId),
    // NOTE: `country` and `category` indexes were dropped — no read query
    // filters on them (country/category filtering happens in the UI's
    // memory after the watch_id-keyed overview query), and they added ~40%
    // write amplification on every poll's INSERT. Keeping writes fast is
    // more valuable than indexes that nothing reads.
    index("snapshots_created_idx").on(t.createdAt),
  ],
);

export type ProductRow = typeof products.$inferSelect;
export type WatchRow = typeof watches.$inferSelect;
export type SnapshotRow = typeof snapshots.$inferSelect;

/**
 * Per-poll metrics: one row per watch poll attempt. Drives the Polling tab's
 * performance analytics — latency (p50/p95), success rate, and listing yield
 * per (retailer, country) and per product. Append-only; prune old rows
 * periodically (the UI only reads the recent window).
 */
export const pollMetrics = pgTable(
  "poll_metrics",
  {
    id: text("id").primaryKey(),
    watchId: text("watch_id")
      .notNull()
      .references(() => watches.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    retailer: text("retailer").notNull(),
    country: text("country").notNull().default("US"),
    /** "ok" | "empty" | "rate_limited" | "error". */
    status: text("status").notNull(),
    /** Wall-clock duration of the adapter.search call (ms). */
    durationMs: integer("duration_ms").notNull(),
    /** Raw listing count returned by the adapter. */
    listings: integer("listings").notNull().default(0),
    /** Listings routed to a known product (after model classification). */
    routed: integer("routed").notNull().default(0),
    /** Short error message when status != ok/empty. */
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("poll_metrics_watch_idx").on(t.watchId),
    index("poll_metrics_retailer_country_idx").on(t.retailer, t.country),
    index("poll_metrics_created_idx").on(t.createdAt),
  ],
);

export type PollMetricRow = typeof pollMetrics.$inferSelect;

/**
 * Single-row table the poller updates on every reconcile loop. The UI reads
 * `lastBeatAt` to light the "poller alive" indicator green / amber / red.
 */
export const pollerHeartbeat = pgTable("poller_heartbeat", {
  id: text("id").primaryKey().default("singleton"),
  lastBeatAt: timestamp("last_beat_at", { withTimezone: true }).notNull().defaultNow(),
  watchCount: integer("watch_count").notNull().default(0),
  retailerCount: integer("retailer_count").notNull().default(0),
  /**
   * Expected seconds between heartbeats for THIS poller shape:
   *  - cron mode (GitHub Actions hourly): 3600 — a beat is written once per
   *    scheduled run, so the UI must tolerate up to ~an hour between beats.
   *  - daemon mode: the reconcile loop interval (e.g. 60s) — beats are
   *    frequent, so the UI's "alive" window stays tight.
   * The UI reads this to decide how stale a beat can be before flagging
   * "Poller Down" — without it, an hourly cron poller would always look dead.
   */
  pollCycleSec: integer("poll_cycle_sec").notNull().default(3600),
});

export type PollerHeartbeatRow = typeof pollerHeartbeat.$inferSelect;

/**
 * Cached image bytes keyed by URL hash. The poller (running on US IPs via
 * GitHub Actions) fetches product images from retailer CDNs — some of which
 * (Newegg/Akamai) block datacenter/VPN IPs with HTTP 400 — and stores the
 * bytes here so the web app's `/api/img` proxy can serve them from Neon
 * regardless of where the browser runs. This makes images work identically
 * in local dev (behind a VPN) and in production (Vercel US): no CDN dependency
 * at request time. Rows are write-once (ON CONFLICT DO NOTHING); the URL is
 * the cache key so a listing whose image URL changes just creates a new row.
 */
export const listingImages = pgTable(
  "listing_images",
  {
    /** SHA-256 hex of the image URL — short, stable, index-friendly. */
    urlHash: text("url_hash").primaryKey(),
    /** The full image URL (for debugging / re-fetch if needed). */
    url: text("url").notNull(),
    /** Raw image bytes (JPEG/PNG/WebP). */
    data: bytea("data").notNull(),
    /** MIME type from the retailer's response, e.g. "image/jpeg". */
    contentType: text("content_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("listing_images_created_idx").on(t.createdAt)],
);

export type ListingImageRow = typeof listingImages.$inferSelect;

/**
 * Audit log of restock alert emails. One row per (watch, listing) alert sent.
 * The poller consults the most recent row for a (watch_id, mpn) before sending
 * so a listing that flaps in/out of stock, or two poller processes observing
 * the same transition (hourly cron + per-minute fast poller), can't double-
 * email within the cooldown window.
 */
export const alertsSent = pgTable(
  "alerts_sent",
  {
    id: text("id").primaryKey(),
    watchId: text("watch_id")
      .notNull()
      .references(() => watches.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Retailer SKU of the listing that restocked (snapshots.mpn). */
    mpn: text("mpn"),
    /** "in_stock" — the status that triggered the alert. */
    status: text("status").notNull(),
    email: text("email").notNull(),
    title: text("title"),
    url: text("url"),
    price: text("price"),
    /** True when the mail provider accepted the message. */
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alerts_sent_watch_mpn_idx").on(t.watchId, t.mpn, t.sentAt)],
);

export type AlertSentRow = typeof alertsSent.$inferSelect;
