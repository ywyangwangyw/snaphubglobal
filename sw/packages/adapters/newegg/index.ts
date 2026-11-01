import type { Listing, RetailerAdapter, SearchOptions, StockStatus } from "@stockwatch/types";

import { RENEWED_OR_REFURBISHED_RE } from "../gpu-catalog";
import { normalizeGpuTitle } from "../normalize";
import { fetchNeweggHtml } from "./search";

/**
 * Newegg adapter. Searches Newegg's storefront and normalizes results into the
 * common `Listing` shape. Generalizes the GPU-specific newegg_search.py from
 * bfms/dealbots: no GPU category node, no MPN extraction — just search +
 * normalize, so any product works.
 *
 * Newegg renders listings into `window.__initialState__` as a JSON blob. The
 * product cards live under `state.Products[]`, each with an `ItemCell` holding
 * the real data (item number, price, stock, title, seller, image). This parser
 * is the single place to update when Newegg changes that markup.
 *
 * NOTE: Newegg sometimes serves a bot-challenge page to non-browser TLS
 * clients. Native fetch works today; if it stops, swap fetchNeweggHtml for a
 * curl_cffi-equivalent (browser-TLS) client — the normalization stays.
 */
const NEWEGG_PAGE_SIZE = 96;

/** Newegg first-party item numbers are `NN-NNN-NNN`. A trailing `R` is the
 *  OPEN BOX listing of that item (14-500-657R → "Open Box: ZOTAC …"), a
 *  trailing `T` the REFURBISHED one (14-137-968T → "Refurbished: MSI …").
 *  Exported so the web app can apply the same rules to historical rows that
 *  predate the stored `condition`. */
export const NEWEGG_OPEN_BOX_ITEM_RE = /^\d{2}-\d{3}-\d{3}R$/i;
export const NEWEGG_REFURB_ITEM_RE = /^\d{2}-\d{3}-\d{3}T$/i;

export class NeweggAdapter implements RetailerAdapter {
  readonly id = "newegg";
  readonly displayName = "Newegg";

  async search(query: string, opts: SearchOptions = {}): Promise<Listing[]> {
    const maxPages = opts.maxPages ?? 3;
    const maxResults = opts.maxResults ?? 20;
    // Per-watch host override targets a country storefront (e.g. www.newegg.ca).
    const host = (opts.host ?? "www.newegg.com").replace(/^https?:\/\//, "");
    const out: Listing[] = [];

    for (let page = 1; page <= maxPages && out.length < maxResults; page++) {
      const n = opts.categoryN ? `&N=${encodeURIComponent(opts.categoryN)}` : "";
      // PageSize=96 (Newegg's max) instead of the default 36: a 180-result
      // search is 2 requests instead of 5, at the same per-request latency.
      const url = `https://${host}/p/pl?d=${encodeURIComponent(query)}&page=${page}&PageSize=${NEWEGG_PAGE_SIZE}${n}`;
      const html = await fetchNeweggHtml(url, opts.signal);
      const products = parseInitialState(html);
      if (products.length === 0) break;
      for (const product of products) {
        const listing = normalize(product, host);
        // Refurbished / open-box listings are KEPT and flagged via
        // `listing.condition` — the poller stores the condition and the
        // dashboard shows a "Renewed" badge. Dropping them here made their
        // stale pre-flag snapshots live forever in the DB.
        if (opts.firstPartyOnly && !listing.firstParty) continue;
        out.push(listing);
        if (out.length >= maxResults) return await this.enrich(out, opts);
      }
      // A short page is the last page — don't spend a request to learn that.
      if (products.length < NEWEGG_PAGE_SIZE - 4) break;
    }
    return await this.enrich(out, opts);
  }

  async checkProduct(url: string, opts: SearchOptions = {}): Promise<Listing | null> {
    const html = await fetchNeweggHtml(url, opts.signal);
    const products = parseInitialState(html);
    return products.length > 0 ? normalize(products[0]!, opts.host ?? "www.newegg.com") : null;
  }

  /**
   * Optionally enrich listings with fields that only appear on each product's
   * detail page — chiefly Newegg's hidden instant rebate ("EXTRA DISCOUNT
   * AVAILABLE. UNLOCK IT HERE"). Search listings carry neither
   * `OriginalUnitPrice` nor `OriginalInstantRebateAmount`, so to surface the
   * real discounted price + savings we fetch each product page (concurrency
   * limited) and merge `originalPrice` / `discountAmount` / authoritative
   * `price` from its `__initialState__.ItemDetail`.
   */
  private async enrich(listings: Listing[], opts: SearchOptions): Promise<Listing[]> {
    if (!opts.enrichDetails || listings.length === 0) return listings;
    // Cap detail-page fetches to stay polite with Newegg's rate limiter —
    // only enrich the top listings (the cheapest / most relevant) per search.
    const limit = 4;
    const targets = listings.slice(0, limit);
    await mapPool(targets, 3, async (l, i) => {
      if (!l.url) return;
      try {
        const html = await fetchNeweggHtml(l.url, opts.signal);
        const d = parseItemDetail(html);
        if (!d) return;
        listings[i] = {
          ...l,
          price: d.finalPrice ?? l.price,
          originalPrice: d.originalUnitPrice ?? l.originalPrice,
          discountAmount: d.instantRebate ?? l.discountAmount,
        };
      } catch (err) {
        console.error(`[newegg] enrich failed for ${l.url}:`, err);
      }
    });
    return listings;
  }
}

// --- Parsing ----------------------------------------------------------------

/** Subset of the Newegg initialState product card we care about. */
interface ProductCard {
  ItemCell?: {
    Item?: string;
    UnitCost?: number;
    FinalPrice?: number;
    Active?: string | boolean;
    Instock?: boolean;
    Model?: string;
    ShippingCharge?: number;
    LowestPrice30Days?: number;
    /** Original list price before any instant rebate / extra discount. */
    OriginalUnitPrice?: number;
    /** Instant rebate amount (the "extra discount available — unlock it here"). */
    OriginalInstantRebateAmount?: number;
    Description?: {
      Title?: string;
      UrlKeywords?: string | null;
      IMDescription?: string;
    };
    ItemManufactory?: { Manufactory?: string };
    Seller?: { SellerName?: string | null; SellerId?: string | null };
    Feature?: {
      IsNew?: boolean;
      IsRefurbished?: boolean;
      IsOpenBoxed?: boolean;
    };
    NewImage?: { ImageName?: string };
    Image?: {
      ImagePathPattern?: { Size: number; PathPattern: string }[];
      Normal?: { ImageName?: string };
    };
  };
}

function parseInitialState(html: string): ProductCard[] {
  const marker = "window.__initialState__ = ";
  const start = html.indexOf(marker);
  if (start === -1) return [];
  const jsonStart = html.indexOf("{", start + marker.length);
  if (jsonStart === -1) return [];
  const jsonEnd = findJsonObjectEnd(html, jsonStart);
  if (jsonEnd === -1) return [];
  try {
    const state = JSON.parse(html.slice(jsonStart, jsonEnd + 1)) as {
      Products?: ProductCard[];
      ItemDetail?: ProductCard["ItemCell"];
    };
    if (Array.isArray(state.Products) && state.Products.length > 0) {
      return state.Products;
    }
    if (state.ItemDetail) {
      return [{ ItemCell: state.ItemDetail }];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Find the index of the `}` that closes the JSON object opening at `openBrace`,
 * respecting string literals and escapes. Newegg sometimes appends extra JS
 * after the JSON before `</script>`, so a naive `indexOf(";</script>")` is not
 * reliable across page variants.
 */
function findJsonObjectEnd(src: string, openBrace: number): number {
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = openBrace; i < src.length; i++) {
    const ch = src[i]!;
    if (inStr) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function normalize(product: ProductCard, host = "www.newegg.com"): Listing {
  const cell = product.ItemCell ?? {};
  const item = cell.Item ?? "";
  const keywords = cell.Description?.UrlKeywords;
  const url = item
    ? keywords
      ? `https://${host}/${keywords}/p/${item}`
      : `https://${host}/p/${item}`
    : "";

  const price = numOrNull(cell.FinalPrice ?? cell.UnitCost);
  const shipping = numOrNull(cell.ShippingCharge);
  const originalPrice = numOrNull(cell.OriginalUnitPrice);
  const discountAmount = numOrNull(cell.OriginalInstantRebateAmount);
  const instock = cell.Instock === true && cell.Active !== "0" && cell.Active !== false;
  const status: StockStatus = instock ? "in_stock" : "out_of_stock";

  // First-party = sold by Newegg itself (no marketplace seller).
  // Newegg-sold cards have an empty SellerId and null/empty SellerName;
  // marketplace cards carry the third-party seller name (e.g. "Halfmoon Tech Store",
  // "Frentosa Marketplace") or start with marketplace item prefixes (9SI*, 1FT*).
  const rawSellerName = cell.Seller?.SellerName ?? null;
  const sellerId = cell.Seller?.SellerId ?? "";
  const isMarketplace =
    Boolean(rawSellerName && rawSellerName.trim() !== "") ||
    Boolean(sellerId && sellerId.trim() !== "") ||
    /^9SI/i.test(item) ||
    /^1FT/i.test(item);

  const firstParty = !isMarketplace;
  const sellerName = rawSellerName?.trim() ? rawSellerName.trim() : isMarketplace ? "Marketplace Seller" : null;

  const rawTitle = cell.Description?.Title ?? "";
  const brandName = cell.ItemManufactory?.Manufactory ?? "";
  const canonicalTitle = rawTitle ? normalizeGpuTitle(rawTitle, brandName) : "";

  // Condition, from Newegg's own flags first. Product pages title these
  // "Refurbished: …", "Open Box: …", "Used - Good: …"; in the search payload
  // they are `IsRefurbished` (item numbers usually end in `T`, IMDescription
  // ends in "REC" = recertified), `IsOpenBoxed` (item numbers end in `R`),
  // and `IsNew:false` with neither flag = used (`9UC…` item numbers). The
  // title regex is the fallback for any variant that lacks the flags.
  const f = cell.Feature;
  const imDesc = cell.Description?.IMDescription ?? "";
  let condition: string;
  if (f?.IsRefurbished === true || /\bREC\b/.test(imDesc)) condition = "refurbished";
  else if (f?.IsOpenBoxed === true || NEWEGG_OPEN_BOX_ITEM_RE.test(item)) condition = "open_box";
  else if (f?.IsNew === false || /^9UC/i.test(item)) condition = "used";
  else if (/\bopen[\s-]?box\b/i.test(rawTitle)) condition = "open_box";
  else if (RENEWED_OR_REFURBISHED_RE.test(rawTitle)) condition = "refurbished";
  else condition = "new";

  const image = pickImage(cell);

  return {
    retailer: "newegg",
    title: rawTitle,
    canonicalTitle,
    url,
    price,
    originalPrice,
    discountAmount,
    shipping,
    status,
    seller: sellerName,
    firstParty,
    condition,
    sku: cell.Model ?? item,
    imageUrl: image,
    raw: cell,
  };
}

/** Build the best available product image URL from Newegg's path patterns. */
function pickImage(cell: ProductCard["ItemCell"]): string {
  const name = cell?.NewImage?.ImageName ?? cell?.Image?.Normal?.ImageName;
  const patterns = cell?.Image?.ImagePathPattern ?? [];
  if (!name || patterns.length === 0) return "";
  // Prefer a ~300px render; fall back to the first pattern.
  const preferred =
    patterns.find((p) => p.Size === 300) ??
    patterns.find((p) => p.Size === 1280) ??
    patterns[0]!;
  return preferred.PathPattern.replace("{ImageName}", name);
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number.parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a Newegg product-detail page and return the main item's price fields
 * from `__initialState__.ItemDetail` — the authoritative source for the
 * hidden instant rebate ("EXTRA DISCOUNT AVAILABLE. UNLOCK IT HERE").
 */
interface ItemDetailPrices {
  finalPrice: number | null;
  originalUnitPrice: number | null;
  instantRebate: number | null;
}

function parseItemDetail(html: string): ItemDetailPrices | null {
  const marker = "window.__initialState__ = ";
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const jsonStart = html.indexOf("{", start + marker.length);
  if (jsonStart === -1) return null;
  const jsonEnd = findJsonObjectEnd(html, jsonStart);
  if (jsonEnd === -1) return null;
  try {
    const state = JSON.parse(html.slice(jsonStart, jsonEnd + 1)) as {
      ItemDetail?: Record<string, unknown>;
    };
    const d = state.ItemDetail;
    if (!d) return null;
    return {
      finalPrice: numOrNull(d.FinalPrice),
      originalUnitPrice: numOrNull(d.OriginalUnitPrice),
      instantRebate: numOrNull(d.OriginalInstantRebateAmount),
    };
  } catch {
    return null;
  }
}

/** Run an async mapper over `items` with at most `concurrency` in flight. */
async function mapPool<T>(
  items: T[],
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
