/**
 * Shared domain types for stockwatch.
 *
 * These are intentionally retailer-agnostic. Per-retailer adapters translate
 * their own listing shapes into these common types.
 */

/** Stock state for a single listing at a point in time. */
export type StockStatus = "in_stock" | "out_of_stock" | "unknown";

/** A normalized listing returned by a retailer adapter. */
export interface Listing {
  /** Adapter id, e.g. "newegg". */
  retailer: string;
  title: string;
  url: string;
  price: number | null;
  shipping: number | null;
  status: StockStatus;
  /** Selling party when not the retailer itself (marketplace listings). */
  seller: string | null;
  /** True when sold by the retailer itself (first-party), not a marketplace seller. */
  firstParty: boolean;
  /** "new" | "open_box" | "refurbished" | "unknown". */
  condition: string;
  /** Manufacturer part number read off the listing, if present. */
  sku: string;
  /** Concise, industry-standard canonical name (the "universal truth" name). */
  canonicalTitle: string;
  /** Product category: "gpu" (the card), "accessory" (a part FOR a card —
   *  water block, cooler, bracket, riser, PSU, etc.), or "other" (drop).
   *  Set by the poller's router from `classifyListingCategory`; adapters
   *  default to leaving this unset, in which case the poller treats the
   *  listing as "gpu" once a model is matched. */
  category?: "gpu" | "accessory" | "other";
  /** Original (pre-discount) list price when a promo/rebate applies, else null. */
  originalPrice: number | null;
  /** Instant rebate / extra-discount amount applied to reach `price`, else null. */
  discountAmount: number | null;
  imageUrl: string;
  /** Raw payload kept for debugging / re-normalization. */
  raw?: unknown;
}

/** Options passed to adapter search/check calls. */
export interface SearchOptions {
  maxPages?: number;
  maxResults?: number;
  /** When true, return only listings sold by the retailer itself (first-party). */
  firstPartyOnly?: boolean;
  /** Retailer-specific category node to scope the search (e.g. Newegg N=100007709 for GPUs). */
  categoryN?: string;
  /**
   * Override the retailer's default storefront host, to target a specific
   * country site (e.g. "www.newegg.ca" for Newegg Canada, "de-store.msi.com"
   * for MSI Germany). When omitted the adapter uses its built-in default.
   */
  host?: string;
  /**
   * When true, the adapter fetches each result's product-detail page to enrich
   * fields not present in search listings (e.g. Newegg's hidden instant-rebate
   * / "extra discount available — unlock it here" price). Costs one extra HTTP
   * request per listing, so keep `maxResults` modest when enabling.
   */
  enrichDetails?: boolean;
  /**
   * Discover-vs-track hint for adapters that keep a pool of known items and
   * can re-check them in bulk by id (Best Buy's priceBlocks). `false` means
   * "skip the search/discovery request and only refresh the known pool";
   * adapters without a bulk tracker ignore it (their listing page IS the
   * bulk fetch). Default: discover.
   */
  discover?: boolean;
  signal?: AbortSignal;
}

/**
 * Contract every retailer module implements. Mirrors the `RetailerChecker`
 * abstract base from bfms/dealbots, generalized beyond GPUs.
 */
export interface RetailerAdapter {
  readonly id: string;
  readonly displayName: string;
  /** Search a retailer by free-text query, return normalized listings. */
  search(query: string, opts?: SearchOptions): Promise<Listing[]>;
  /** Check a specific product URL, return its current listing (or null). */
  checkProduct(url: string, opts?: SearchOptions): Promise<Listing | null>;
}

/** A product being tracked. */
export interface Product {
  id: string;
  name: string;
  mpn: string | null;
  upc: string | null;
  imageUrl: string | null;
  createdAt: string;
}

/** A watch binds a product to a retailer query on a poll interval. */
export interface Watch {
  id: string;
  productId: string;
  retailer: string;
  query: string;
  pollIntervalSec: number;
  enabled: boolean;
  createdAt: string;
}

/** Append-only snapshot of one watch poll. */
export interface Snapshot {
  id: string;
  watchId: string;
  productId: string;
  retailer: string;
  inStock: boolean;
  status: StockStatus;
  price: number | null;
  shipping: number | null;
  seller: string | null;
  title: string | null;
  url: string | null;
  raw: unknown;
  createdAt: string;
}

/** Event payload streamed over SSE when a new snapshot is written. */
export interface SnapshotEvent {
  type: "snapshot";
  snapshot: Snapshot;
}
