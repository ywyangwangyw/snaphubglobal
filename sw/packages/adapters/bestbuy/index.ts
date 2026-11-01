import type { Listing, RetailerAdapter, SearchOptions, StockStatus } from "@stockwatch/types";

import { classifyGpuModel } from "../gpu-catalog";
import { normalizeGpuTitle } from "../normalize";

/**
 * Best Buy (US) adapter — **two paths, no API key required.**
 *
 * 1. **SSR discovery + priceBlocks tracking (default, key-less)** — fetch
 *    `bestbuy.com/site/searchpage.jsp?st=<q>` with a **Chrome TLS
 *    fingerprint** (`got-scraping`, the Node `curl_cffi` equivalent). The
 *    Apollo SSR payload now carries only the first ~4 products of a page, so
 *    it's used to DISCOVER SKUs (and numFound); live price / `buttonState`
 *    (ADD_TO_CART ⇒ in stock, SOLD_OUT ⇒ out) for every known first-party SKU
 *    comes from the public `/api/3.0/priceBlocks?skus=…` JSON endpoint, 40
 *    SKUs per request. The SKU pool is seeded by the poller from the DB
 *    (`setBestBuyKnownSkus`) and grows with each discovery. The poller injects
 *    the TLS-impersonation fetcher via `setBestBuyFetcher`; without it (e.g.
 *    in tests) the adapter falls back to the API path below.
 *
 * 2. **Developer API (optional)** — if `BESTBUY_API_KEY` is set, use Best
 *    Buy's free public Products API (developer.bestbuy.com) instead: a plain
 *    JSON GET returning name / salePrice / regularPrice / onlineAvailability /
 *    sku / url / image. Free tier: 50k calls/day, 5/sec — the poller uses
 *    ~6 calls/hour. The API is only used when a key is present; otherwise the
 *    key-less SSR scrape is the primary path.
 *
 * bestbuy.com geo-blocks non-US IPs (a "Select your Country" page), so the
 * SSR scrape only works from a US egress IP (the GitHub-Actions runner is US).
 * Prices are USD. Best Buy sells direct ⇒ every listing is first-party.
 * US-only (Best Buy CA is a separate site; not seeded).
 */

const API = "https://api.bestbuy.com/v1/products";
const SEARCH_URL = "https://www.bestbuy.com/site/searchpage.jsp";

/** Fields to request (keeps the payload small). */
const SHOW = [
  "sku",
  "name",
  "salePrice",
  "regularPrice",
  "onSale",
  "onlineAvailability",
  "onlineAvailabilityText",
  "url",
  "image",
  "manufacturer",
  "condition",
].join(",");

// --- TLS-impersonation fetcher (injected by the poller) ---------------------
// The adapters package has no got-scraping dep; the poller injects a Chrome-
// fingerprint fetcher so this stays bundle-light. Default = none (API-only).
type HtmlFetcher = (url: string, signal?: AbortSignal) => Promise<string>;
let ssrFetcher: HtmlFetcher | null = null;

/** Inject the TLS-impersonation HTML fetcher (called by the poller). Enables
 *  the key-less SSR-scrape path. */
export function setBestBuyFetcher(fn: HtmlFetcher): void {
  ssrFetcher = fn;
}


export class BestBuyAdapter implements RetailerAdapter {
  readonly id = "bestbuy";
  readonly displayName = "Best Buy";

  private get apiKey(): string | null {
    return process.env.BESTBUY_API_KEY ?? null;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<Listing[]> {
    const maxResults = opts.maxResults ?? 60;
    // Prefer the key-less SSR scrape (works from a US IP without any API key,
    // mirroring bfms). Only use the Developer API when a key is explicitly set.
    if (!this.apiKey) {
      if (!ssrFetcher) {
        throw new Error(
          "Best Buy has no API key and no TLS-impersonation fetcher — set BESTBUY_API_KEY, or run under the poller (which injects the SSR fetcher)",
        );
      }
      return searchScrape(query, opts, maxResults, ssrFetcher);
    }
    return this.searchApi(query, opts, maxResults);
  }

  /** Developer-API path (only when BESTBUY_API_KEY is set). */
  private async searchApi(query: string, opts: SearchOptions, maxResults: number): Promise<Listing[]> {
    const key = this.apiKey!;
    const maxPages = opts.maxPages ?? 2;
    const pageSize = Math.min(maxResults, 100);

    const out: Listing[] = [];
    for (let page = 1; page <= maxPages && out.length < maxResults; page++) {
      const url =
        `${API}(search=${encodeURIComponent(query)})?apiKey=${encodeURIComponent(key)}` +
        `&format=json&show=${encodeURIComponent(SHOW)}` +
        `&sort=bestSellingRank.asc&pageSize=${pageSize}&page=${page}`;
      const data = await fetchJson<BestBuyProductsResponse>(url, opts.signal);
      if (!data) break;
      const products = data.products ?? [];
      if (products.length === 0) break;
      for (const p of products) {
        const listing = normalize(p);
        if (!listing) continue;
        // Keep only graphics cards: the search hits laptops/desktops/waterblocks
        // that share the query string; require GeForce/Radeon in the name.
        if (!/GeForce|Radeon/i.test(listing.title)) continue;
        if (opts.firstPartyOnly && !listing.firstParty) continue;
        out.push(listing);
        if (out.length >= maxResults) break;
      }
    }
    return out;
  }

  async checkProduct(url: string, opts: SearchOptions = {}): Promise<Listing | null> {
    const key = this.apiKey;
    if (!key) return null;
    // Product URLs end with `/<skuId>.p` — look up by SKU.
    const sku = skuFromUrl(url);
    if (!sku) return null;
    const api = `${API}(sku=${encodeURIComponent(sku)})?apiKey=${encodeURIComponent(key)}&format=json&show=${encodeURIComponent(SHOW)}`;
    const data = await fetchJson<BestBuyProductsResponse>(api, opts.signal);
    const p = data?.products?.[0];
    return p ? normalize(p) : null;
  }
}

// --- Fetch ------------------------------------------------------------------

interface BestBuyProductsResponse {
  products?: BestBuyProduct[];
  errorMessage?: string;
  error?: string;
}

interface BestBuyProduct {
  sku: number | string;
  name: string;
  salePrice?: number | null;
  regularPrice?: number | null;
  onSale?: boolean;
  onlineAvailability?: boolean;
  onlineAvailabilityText?: string;
  url?: string;
  image?: string;
  manufacturer?: string;
  condition?: string;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "stockwatch-poller/1.0" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (res.status === 429) {
      console.warn(`[bestbuy] rate limited (5/sec) — backing off`);
      return null;
    }
    if (!res.ok) {
      console.warn(`[bestbuy] API HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[bestbuy] fetch failed:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- Normalize --------------------------------------------------------------

function normalize(p: BestBuyProduct): Listing | null {
  const title = p.name?.trim();
  if (!title) return null;
  const price = numOrNull(p.salePrice);
  const regular = numOrNull(p.regularPrice);
  const originalPrice = p.onSale && regular != null && price != null && regular > price ? regular : null;
  const discountAmount =
    originalPrice != null && price != null ? Math.round((originalPrice - price) * 100) / 100 : null;
  const status: StockStatus = p.onlineAvailability ? "in_stock" : "out_of_stock";
  const url = p.url ?? (p.sku ? `https://www.bestbuy.com/site/${slugify(title)}/${p.sku}.p` : "");
  return {
    retailer: "bestbuy",
    title,
    canonicalTitle: normalizeGpuTitle(title, p.manufacturer ?? brandFrom(title)),
    url,
    price,
    originalPrice,
    discountAmount,
    shipping: null,
    status,
    seller: "Best Buy",
    firstParty: true,
    condition: p.condition ?? "new",
    sku: String(p.sku ?? ""),
    imageUrl: p.image ?? "",
    raw: { currency: "USD", onlineAvailabilityText: p.onlineAvailabilityText ?? null },
  };
}

// --- Helpers ----------------------------------------------------------------
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number.parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function skuFromUrl(url: string): string {
  const m = url.match(/(\d{5,})\.p\b/);
  return m ? (m[1] ?? "") : "";
}

function slugify(s: string): string {
  return (s || "product").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function brandFrom(title: string): string {
  return title.trim().split(/\s+/)[0] ?? "";
}

// --- Key-less SSR scrape (mirrors bfms `bestbuy_search._scrape_bestbuy`) ------
//
// Best Buy's search page is Next.js/Apollo SSR: it embeds a `rehydrate` JSON
// blob inside a `<script>` (the one containing `customerPrice`). That blob's
// `data.detailedProductSearch.documents[].product` holds the full result set
// — name, skuId, customerPrice, buttonState (stock), url, manufacturer, image
// — as server-rendered JSON. We pull that script, JSON.parse it, and walk the
// tree. No API key, no headless browser; just a Chrome-TLS-fingerprint GET
// (injected by the poller via `setBestBuyFetcher`).

//
// Oct 2026: Best Buy now server-renders only the first FOUR products of a
// results page (`pagination.offset: 4`); the rest load client-side through an
// Akamai-guarded GraphQL POST we can't replay. So the SSR page is used for
// DISCOVERY (new SKUs + numFound) and the real tracking runs on the public
// `/api/3.0/priceBlocks?skus=…` JSON endpoint, which answers price + button
// state for 40 first-party SKUs per ~0.5s request. Known SKUs persist in a
// process-level pool — seeded by the poller from the DB (`setBestBuyKnownSkus`)
// so a fresh cron process already knows the ~100 RTX 50 SKUs — and every SSR
// discovery adds to it. One priceBlocks refresh is shared by all concurrent
// Best Buy watches (single-flight, 45s cache). Net: 7 watches ≈ 7 SSR GETs +
// 3 priceBlocks GETs per run, instead of 7 × (SSR + 30s of failures).

const PRICE_BLOCKS_URL = "https://www.bestbuy.com/api/3.0/priceBlocks";
/** priceBlocks silently returns at most 25 entries per call — anything past
 *  that is dropped without an error, so never ask for more. */
const PRICE_BLOCK_CHUNK = 25;
const PRICE_BLOCK_TTL_MS = 45_000;

/** What we remember about a Best Buy SKU between polls. */
export interface BestBuyKnownSku {
  sku: string;
  title: string;
  url?: string | null;
  imageUrl?: string | null;
  /** false ⇒ marketplace (3P) — priceBlocks 404s these; SSR-only. */
  firstParty?: boolean;
}

const knownSkus = new Map<string, BestBuyKnownSku>();
/** SKUs priceBlocks reported "product not found" — skip them for the process. */
const deadSkus = new Set<string>();

/** Seed the SKU pool (poller calls this with SKUs from recent DB snapshots). */
export function setBestBuyKnownSkus(list: BestBuyKnownSku[]): void {
  for (const k of list) {
    const sku = String(k.sku).trim();
    if (!sku) continue;
    const prev = knownSkus.get(sku);
    knownSkus.set(sku, { ...prev, ...k, sku, title: k.title || prev?.title || "" });
  }
}

/** Current pool size (diagnostics). */
export function bestBuyKnownSkuCount(): number {
  return knownSkus.size;
}

interface PriceBlock {
  price: number | null;
  regularPrice: number | null;
  savings: number | null;
  buttonState: string;
  title: string;
  brand: string;
  url: string | null;
}

let priceBlockCache: { at: number; blocks: Map<string, PriceBlock>; p: Promise<Map<string, PriceBlock>> } | null = null;

/** priceBlocks for every first-party known SKU — single-flight + short TTL so
 *  the 7 concurrent watches share one refresh. */
function refreshPriceBlocks(fetcher: HtmlFetcher, signal?: AbortSignal): Promise<Map<string, PriceBlock>> {
  if (priceBlockCache && Date.now() - priceBlockCache.at < PRICE_BLOCK_TTL_MS) return priceBlockCache.p;
  const at = Date.now();
  const p = (async () => {
    const blocks = new Map<string, PriceBlock>();
    const skus = [...knownSkus.values()]
      .filter((k) => k.firstParty !== false && !deadSkus.has(k.sku))
      .map((k) => k.sku);
    const chunks: string[][] = [];
    for (let i = 0; i < skus.length; i += PRICE_BLOCK_CHUNK) chunks.push(skus.slice(i, i + PRICE_BLOCK_CHUNK));
    let okN = 0;
    let errN = 0;
    let failedChunks = 0;
    await Promise.all(
      chunks.map(async (chunk) => {
        let body: string;
        try {
          body = await fetcher(`${PRICE_BLOCKS_URL}?skus=${chunk.join(",")}`, signal);
        } catch (err) {
          failedChunks++;
          console.warn(`[bestbuy] priceBlocks failed:`, err instanceof Error ? err.message : err);
          return;
        }
        let arr: any[];
        try {
          arr = JSON.parse(body);
        } catch {
          failedChunks++;
          console.warn(`[bestbuy] priceBlocks returned non-JSON (${body.slice(0, 80)})`);
          return;
        }
        if (!Array.isArray(arr)) {
          failedChunks++;
          console.warn(`[bestbuy] priceBlocks returned non-array JSON (${body.slice(0, 120)})`);
          return;
        }
        // A chunk where EVERY entry errored is an API hiccup, not 25 dead
        // SKUs — don't poison the pool for the rest of this process.
        const errored = arr.filter((b) => b?.sku?.error).length;
        const chunkHealthy = errored < arr.length;
        for (const b of arr) {
          const s = b?.sku;
          if (!s || typeof s !== "object") continue;
          const sku = String(s.skuId ?? "").trim();
          if (!sku) continue;
          if (s.error) {
            errN++;
            // "not found" = gone; "Failed to retrieve price" = a marketplace
            // (8-digit) SKU this first-party endpoint will never price. Either
            // way it would just burn one of the 25 slots again next call.
            if (chunkHealthy) deadSkus.add(sku);
            continue;
          }
          okN++;
          const pd = s.price?.priceDomain ?? {};
          const price = numOrNull(pd.customerPrice ?? s.price?.currentPrice ?? pd.currentPrice);
          const regular = numOrNull(pd.regularPrice ?? s.price?.regularPrice);
          const savings = numOrNull(pd.totalSavings ?? s.price?.savingsAmount);
          blocks.set(sku, {
            price,
            regularPrice: regular,
            savings,
            buttonState: String(s.buttonState?.buttonState ?? "").toUpperCase(),
            title: String(s.names?.short ?? "").trim(),
            brand: String(s.brand?.brand ?? "").trim(),
            url: typeof s.url === "string" ? s.url : null,
          });
        }
      }),
    );
    console.log(
      `[bestbuy] priceBlocks: ${skus.length} tracked SKU(s) in ${chunks.length} call(s) -> ${okN} priced, ${errN} unpriceable` +
        (failedChunks ? `, ${failedChunks} call(s) FAILED` : "") +
        ` in ${Date.now() - at}ms`,
    );
    if (priceBlockCache) priceBlockCache.blocks = blocks;
    return blocks;
  })();
  priceBlockCache = { at, blocks: new Map(), p };
  return p;
}

/** Discovery: the SSR search page (now only the top ~4 products, but also
 *  marketplace ones + numFound). Adds anything new to the SKU pool. */
async function discoverViaSsr(
  query: string,
  opts: SearchOptions,
  fetcher: HtmlFetcher,
): Promise<{ listings: Listing[]; numFound: number | null }> {
  const url = `${SEARCH_URL}?st=${encodeURIComponent(query)}&cp=1&sp=-bestsellingsort+skuidsaas`;
  const html = await fetcher(url, opts.signal);
  const data = extractApolloSsr(html);
  if (!data) {
    if (/select your country|choose your country|countryselection/i.test(html)) {
      throw new Error("Best Buy returned the geo-block page — needs a US egress IP (set a US proxy or run from the US GitHub-Actions runner)");
    }
    throw new Error("Best Buy SSR payload not found in search page (structure changed?)");
  }
  const docs = documentsFromRehydrate(data);
  const listings: Listing[] = [];
  for (const doc of docs) {
    const product = doc?.product ?? doc;
    const listing = parseSsrProduct(product);
    if (!listing) continue;
    listings.push(listing);
    const sku = listing.sku!;
    const prev = knownSkus.get(sku);
    knownSkus.set(sku, {
      sku,
      title: listing.title,
      url: listing.url || prev?.url,
      imageUrl: listing.imageUrl || prev?.imageUrl,
      firstParty: listing.firstParty,
    });
  }
  return { listings, numFound: numFoundFromSsr(data) };
}

async function searchScrape(
  query: string,
  opts: SearchOptions,
  maxResults: number,
  fetcher: HtmlFetcher,
): Promise<Listing[]> {
  const wantModel = classifyGpuModel(query);

  // Discover vs track: the search page is only needed to find NEW SKUs; the
  // known pool is re-checked in bulk via priceBlocks (40 SKUs per call). The
  // poller asks for discovery on a slow cadence (hours) and tracking every
  // cycle, so most polls are 2–3 priceBlocks calls and no search at all.
  const trackOnly = opts.discover === false && knownSkus.size > 0;
  const noDiscovery = { listings: [] as Listing[], numFound: null as number | null };
  const discover = () =>
    discoverViaSsr(query, opts, fetcher).catch((err) => {
      // Discovery failing shouldn't kill tracking of the ~100 known SKUs —
      // but with an EMPTY pool there's nothing else to return, so surface it.
      if (knownSkus.size === 0) throw err;
      console.warn(`[bestbuy] SSR discovery failed (tracking known SKUs only):`, err instanceof Error ? err.message : err);
      return noDiscovery;
    });
  let ssr: { listings: Listing[]; numFound: number | null };
  let blocks: Map<string, PriceBlock>;
  if (trackOnly) {
    blocks = await refreshPriceBlocks(fetcher, opts.signal);
    // The bulk endpoint came back empty for a non-empty pool: API hiccup.
    // Fall back to the search page so this cycle isn't blank.
    ssr = blocks.size === 0 ? await discover() : noDiscovery;
  } else {
    [ssr, blocks] = await Promise.all([discover(), refreshPriceBlocks(fetcher, opts.signal)]);
  }
  // Anything the SSR page discovered that wasn't in the pool when the
  // refresh started gets picked up on the next poll; this one still returns
  // its SSR listing directly.

  const out = new Map<string, Listing>();
  for (const [sku, b] of blocks) {
    const k = knownSkus.get(sku);
    const title = k?.title || b.title;
    if (!title) continue;
    const l = listingFromBlock(sku, b, k);
    out.set(sku, l);
  }
  for (const l of ssr.listings) out.set(l.sku!, l);

  const result: Listing[] = [];
  for (const l of out.values()) {
    // Pool titles are canonical ("ASUS TUF RTX 5080 OC 16GB" — no "GeForce"),
    // so gate on the model classifier too, not only the brand words.
    const title = l.canonicalTitle || l.title;
    if (!/GeForce|Radeon|\bRTX\s?\d{4}/i.test(l.title) && !classifyGpuModel(title)) continue;
    // Each watch returns only ITS model's cards (like the MSI adapter), so
    // seven watches sharing one pool don't each emit the whole pool.
    if (wantModel && classifyGpuModel(l.canonicalTitle || l.title) !== wantModel) continue;
    if (opts.firstPartyOnly && !l.firstParty) continue;
    result.push(l);
    if (result.length >= maxResults) break;
  }
  return result;
}

function listingFromBlock(sku: string, b: PriceBlock, k: BestBuyKnownSku | undefined): Listing {
  // priceBlocks' `names.short` is "BRAND - Title"; the SSR/pool title has no
  // brand prefix. Prefer the pool title, else strip the prefix.
  const title = k?.title || (b.brand && b.title.startsWith(`${b.brand} - `) ? b.title.slice(b.brand.length + 3) : b.title);
  const brand = b.brand || brandFrom(title);
  let status: StockStatus = "out_of_stock";
  if (b.buttonState === "ADD_TO_CART" || b.buttonState === "ADD_TO_CART_PRESELECT" || b.buttonState === "PRE_ORDER") {
    status = "in_stock";
  } else if (!b.buttonState) {
    status = "unknown";
  }
  const price = b.price;
  const originalPrice = b.regularPrice != null && price != null && b.regularPrice > price ? b.regularPrice : null;
  const discountAmount =
    originalPrice != null && price != null ? Math.round((originalPrice - price) * 100) / 100 : null;
  const url = k?.url || (b.url ? (b.url.startsWith("http") ? b.url : `https://www.bestbuy.com${b.url}`) : `https://www.bestbuy.com/site/${sku}.p?skuId=${sku}`);
  const imageUrl =
    k?.imageUrl || `https://pisces.bbystatic.com/image2/BestBuy_US/images/products/${sku.slice(0, 4)}/${sku}_sd.jpg`;
  return {
    retailer: "bestbuy",
    title,
    canonicalTitle: normalizeGpuTitle(title, brand),
    url,
    price,
    originalPrice,
    discountAmount,
    shipping: null,
    status,
    seller: "Best Buy",
    firstParty: true,
    condition: "new",
    sku,
    imageUrl,
    raw: { currency: "USD", buttonState: b.buttonState || null, source: "price-blocks" },
  };
}

/** Pull the product list out of Best Buy's search HTML. Best Buy ships the
 *  search results as an Apollo SSR data-transport push:
 *    (window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({"rehydrate":{...}})
 *  The `rehydrate` tree contains a `detailedProductSearch.documents[].product`
 *  node (skuId / url.pdp / primaryImage / name / price / fulfillmentOptions).
 *  We find the `<script>` containing `detailedProductSearch` (the price config
 *  lives in a *different* rehydrate script, so `customerPrice` is the wrong
 *  selector), brace-match the `.push({...})` arg, replace literal `undefined`
 *  with `null`, JSON.parse it, and return `{ documents }`. Mirrors bfms's
 *  `bestbuy_search._scrape_bestbuy`. */
function extractApolloSsr(html: string): any | null {
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const txt = m[1] ?? "";
    if (!txt.includes("detailedProductSearch")) continue;
    const pushIdx = txt.indexOf(".push(");
    if (pushIdx < 0) continue;
    const braceStart = txt.indexOf("{", pushIdx);
    if (braceStart < 0) continue;
    const objJson = braceMatch(txt, braceStart);
    if (!objJson) continue;
    try {
      return JSON.parse(objJson.replace(/\bundefined\b/g, "null"));
    } catch {
      continue;
    }
  }
  return null;
}

/** From `s[start]` (a `{`), return the balanced JSON object string. */
function braceMatch(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Walk `data.documents` (direct), `data.rehydrate.*.data…` (Apollo ≤ Sep
 *  2026) or `data.events[].value.data…` (Apollo streaming transport, Oct
 *  2026+ — `rehydrate` is now `{}` and results arrive as `next` events). */
function documentsFromRehydrate(data: any): any[] {
  if (Array.isArray(data?.documents)) return data.documents;
  const rehydrate = data?.rehydrate;
  if (rehydrate && typeof rehydrate === "object") {
    for (const val of Object.values(rehydrate)) {
      const dps = (val as any)?.data?.detailedProductSearch;
      if (dps && Array.isArray(dps.documents)) return dps.documents;
    }
  }
  const events = data?.events;
  if (Array.isArray(events)) {
    for (const ev of events) {
      const dps = ev?.value?.data?.detailedProductSearch;
      if (dps && Array.isArray(dps.documents)) return dps.documents;
    }
  }
  return [];
}

/** Total hits for the query, when the SSR payload carries it. */
function numFoundFromSsr(data: any): number | null {
  const events = data?.events;
  if (!Array.isArray(events)) return null;
  for (const ev of events) {
    const n = ev?.value?.data?.search?.numFound;
    if (typeof n === "number") return n;
  }
  return null;
}

function parseSsrProduct(product: any): Listing | null {
  if (!product || typeof product !== "object") return null;
  const nameObj = product.name;
  const title =
    (typeof nameObj === "object" ? String(nameObj?.title ?? "") : String(nameObj ?? "")).trim();
  if (!title) return null;
  const sku = String(product.skuId ?? "").trim();
  if (!sku) return null;

  const priceObj = product.price ?? {};
  const rawPrice = priceObj?.customerPrice ?? priceObj?.currentPrice;
  const price = numOrNull(rawPrice);
  const regular = numOrNull(priceObj?.displayableRegularPrice ?? priceObj?.regularPrice);
  const originalPrice = regular != null && price != null && regular > price ? regular : null;
  const discountAmount =
    originalPrice != null && price != null ? Math.round((originalPrice - price) * 100) / 100 : null;

  // Marketplace (3P) sellers: `seller.classification === "3P"`. Their SKUs
  // aren't served by priceBlocks, so this flag keeps them SSR-only.
  const sellerObj = product.seller;
  const thirdParty = !!sellerObj && typeof sellerObj === "object" && String(sellerObj.classification ?? "").toUpperCase() === "3P";
  const sellerName = thirdParty ? String(sellerObj?.name ?? sellerObj?.sellerName ?? "Marketplace seller").trim() : "Best Buy";

  // Stock: fulfillmentOptions.buttonStates[0].buttonState
  let btnState = "";
  const fo = product.fulfillmentOptions;
  if (fo && Array.isArray(fo.buttonStates) && fo.buttonStates[0]) {
    btnState = String(fo.buttonStates[0].buttonState ?? "").toUpperCase();
  }
  let status: StockStatus = "out_of_stock";
  if (btnState === "ADD_TO_CART" || btnState === "ADD_TO_CART_PRESELECT") status = "in_stock";
  else if (btnState === "SOLD_OUT" || btnState === "UNAVAILABLE") status = "out_of_stock";
  else if (price != null) status = "in_stock"; // fallback: priced ⇒ likely in stock

  const urlRaw = product.url;
  const urlPath =
    (typeof urlRaw === "object" ? String(urlRaw?.pdp ?? urlRaw?.url ?? "") : String(urlRaw ?? "")) ||
    `/site/${sku}.p?skuId=${sku}`;
  const url = urlPath.startsWith("http") ? urlPath : `https://www.bestbuy.com${urlPath}`;

  const mfrObj = product.manufacturer ?? {};
  const brand =
    (typeof mfrObj === "object" ? String(mfrObj?.name ?? "") : String(mfrObj ?? "")).trim() ||
    brandFrom(title);

  let imageUrl = "";
  const primary = product.primaryImage;
  if (primary && typeof primary === "object") {
    imageUrl = String(primary.piscesHref ?? primary.href ?? primary.url ?? "");
  }
  if (!imageUrl) {
    const media = product.images;
    if (Array.isArray(media) && media.length) imageUrl = String(media[0] ?? "");
    else if (media && typeof media === "object") imageUrl = String(media.primary ?? media.standard ?? "");
  }
  if (!imageUrl) imageUrl = `https://pisces.bbystatic.com/image2/BestBuy_US/images/products/${sku.slice(0, 4)}/${sku}_sd.jpg`;

  return {
    retailer: "bestbuy",
    title,
    canonicalTitle: normalizeGpuTitle(title, brand),
    url,
    price,
    originalPrice,
    discountAmount,
    shipping: null,
    status,
    seller: sellerName,
    firstParty: !thirdParty,
    condition: "new",
    sku,
    imageUrl,
    raw: { currency: "USD", buttonState: btnState || null, source: "ssr-scrape" },
  };
}
