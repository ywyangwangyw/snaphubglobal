import * as cheerio from "cheerio";

import type { Listing, RetailerAdapter, SearchOptions, StockStatus } from "@stockwatch/types";

import { RENEWED_OR_REFURBISHED_RE } from "../gpu-catalog";
import { normalizeGpuTitle } from "../normalize";

/**
 * MSI adapter. Searches MSI's official Shopify storefront via the Storefront
 * GraphQL API — a clean, unauthenticated JSON endpoint (no HTML scraping, no
 * bot-bypass needed).
 *
 * Why GraphQL and not scraping: MSI's storefronts sit behind Akamai which 403s
 * non-browser TLS clients (curl/Node fetch). But every MSI regional store is a
 * Shopify shop, and Shopify exposes a public Storefront GraphQL endpoint at
 * `/api/<version>/graphql.json` that returns product data as JSON. The regional
 * stores (uk/it/es-store.msi.com) are reachable from a server.
 *
 * The US front (us-store.msi.com) is the exception: it is NOT a Shopify store
 * (the GraphQL endpoint 404s), so it takes a separate HTML-scrape path — see
 * `searchUsStore` below, which reads the server-rendered RTX 50 category grid.
 *
 * MSI only sells MSI-branded cards direct, so a search for "RTX 5060" returns
 * MSI's own GeForce SKUs (e.g. "GeForce RTX 5060 8G GAMING OC"). We keep only
 * `GeForce …` titles so laptop/desktop hits that share the query string drop
 * out. Prices come back in the store's currency (GBP for uk-store); the numeric
 * value is passed through and the currency code is kept on `raw`.
 */
export class MsiAdapter implements RetailerAdapter {
  readonly id = "msi";
  readonly displayName = "MSI Store";

  private get host(): string {
    return (process.env.MSI_STORE_HOST ?? "uk-store.msi.com").replace(/^https?:\/\//, "");
  }

  async search(query: string, opts: SearchOptions = {}): Promise<Listing[]> {
    const maxResults = opts.maxResults ?? 20;
    // Per-watch host override lets us target a specific regional MSI storefront
    // (us/uk/de/fr/ca-store.msi.com); falls back to the env default.
    const host = (opts.host ?? this.host).replace(/^https?:\/\//, "");

    // MSI US (us-store.msi.com) is NOT a Shopify store (unlike uk/de/fr), so
    // there's no Storefront GraphQL. Its category/search pages are server-
    // rendered, though — scrape the RTX 50 Series category grid directly.
    if (host === "us-store.msi.com") {
      return searchUsStore(query, opts, host, maxResults);
    }

    const api = `https://${host}/api/2024-01/graphql.json`;

    // Shopify `products(query:)` does a substring/field search. `first` caps the
    // result count (max 250 per request) — one round-trip is plenty for a GPU
    // model query on a single-brand store.
    const gql = {
      query: `query Search($q: String!, $n: Int!) {
        products(first: $n, query: $q, sortKey: RELEVANCE) {
          edges {
            node {
              id
              title
              handle
              onlineStoreUrl
              availableForSale
              images(first: 1) { edges { node { url } } }
              variants(first: 1) {
                edges {
                  node {
                    sku
                    price { amount currencyCode }
                    compareAtPrice { amount currencyCode }
                  }
                }
              }
            }
          }
        }
      }`,
      variables: { q: query, n: Math.min(maxResults, 250) },
    };

    const res = await fetchJson(api, gql, opts.signal);
    const edges = res?.data?.products?.edges ?? [];

    const out: Listing[] = [];
    for (const e of edges) {
      const node = e.node;
      const listing = normalize(node, host);
      if (!listing) continue;
      // Refurbished / renewed items are kept and flagged via `listing.condition`.
      // Keep only graphics cards: MSI names its GPU SKUs "...GeForce ...".
      // Regional titles don't always START with "GeForce" (e.g. DE uses
      // "MSI Grafikkarte GeForce RTX ...", FR uses "MSI GeForce RTX ..."),
      // so match "GeForce" anywhere in the title, not just at the start.
      // This drops laptops/desktops that happen to match the query string.
      if (!/GeForce/i.test(listing.title)) continue;
      if (opts.firstPartyOnly && !listing.firstParty) continue;
      out.push(listing);
      if (out.length >= maxResults) break;
    }
    return out;
  }

  async checkProduct(url: string, opts: SearchOptions = {}): Promise<Listing | null> {
    const host = (opts.host ?? safeHost(url) ?? this.host).replace(/^https?:\/\//, "");
    // MSI US is a custom (non-Shopify) storefront — scrape the product page.
    if (host === "us-store.msi.com") {
      return checkUsProduct(url, host, opts.signal);
    }
    // Resolve a product by its onlineStoreUrl via the Storefront API by handle.
    const handle = url.split("/products/")[1]?.split(/[?#]/)[0];
    if (!handle) return null;
    const api = `https://${host}/api/2024-01/graphql.json`;
    const gql = {
      query: `query ByHandle($h: String!) {
        productByHandle(handle: $h) {
          id title handle onlineStoreUrl availableForSale
          images(first: 1) { edges { node { url } } }
          variants(first: 1) {
            edges { node { sku price { amount currencyCode } compareAtPrice { amount currencyCode } } }
          }
        }
      }`,
      variables: { h: handle },
    };
    const res = await fetchJson(api, gql, opts.signal);
    const node = res?.data?.productByHandle;
    return node ? normalize(node, host) : null;
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// --- Fetch ------------------------------------------------------------------

interface GraphQlResponse {
  data?: {
    products?: { edges: Array<{ node: ProductNode }> };
    productByHandle?: ProductNode | null;
  };
  errors?: Array<{ message: string }>;
}

interface ProductNode {
  id: string;
  title: string;
  handle: string;
  onlineStoreUrl: string | null;
  availableForSale: boolean;
  images: { edges: Array<{ node: { url: string } }> };
  variants: {
    edges: Array<{
      node: {
        sku: string | null;
        price: { amount: string; currencyCode: string } | null;
        compareAtPrice: { amount: string; currencyCode: string } | null;
      };
    }>;
  };
}

async function fetchJson(api: string, body: unknown, signal?: AbortSignal): Promise<GraphQlResponse | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  // Link abort: if the caller's signal fires, abort ours too.
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(api, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      // The Storefront API is a public read endpoint; no credentials needed.
    });
    if (!res.ok) {
      console.warn(`[msi] ${api} -> HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as GraphQlResponse;
  } catch (err) {
    console.warn(`[msi] fetch failed:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- Normalize --------------------------------------------------------------

function normalize(node: ProductNode, host: string): Listing | null {
  const variant = node.variants.edges[0]?.node;
  const price = variant?.price ? numOrNull(variant.price.amount) : null;
  const compareAt = variant?.compareAtPrice ? numOrNull(variant.compareAtPrice.amount) : null;
  const currency = variant?.price?.currencyCode ?? null;
  const sku = variant?.sku ?? "";
  const url = node.onlineStoreUrl ?? `https://${host}/products/${node.handle}`;
  const image = node.images.edges[0]?.node.url ?? "";
  const available = node.availableForSale;
  const status: StockStatus = available ? "in_stock" : "out_of_stock";

  // compareAtPrice > price ⇒ a sale: original = compareAt, discount = diff.
  const originalPrice = compareAt && price != null && compareAt > price ? compareAt : null;
  const discountAmount =
    originalPrice != null && price != null ? Math.round((originalPrice - price) * 100) / 100 : null;

  const canonicalTitle = normalizeGpuTitle(node.title, "MSI");
  const isRenewed = RENEWED_OR_REFURBISHED_RE.test(node.title);

  return {
    retailer: "msi",
    title: node.title,
    canonicalTitle,
    url,
    price,
    originalPrice,
    discountAmount,
    shipping: null, // Shopify Storefront doesn't expose shipping per-listing.
    status,
    // MSI's own store: every listing is first-party (sold by MSI).
    seller: "MSI",
    firstParty: true,
    condition: isRenewed ? "refurbished" : "new",
    sku,
    imageUrl: image,
    raw: { id: node.id, currency, availableForSale: available },
  };
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number.parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// --- MSI US (us-store.msi.com) — HTML category scrape -----------------------
//
// us-store.msi.com is a custom (non-Shopify) storefront: no /api/.../graphql
// endpoint (404), and its search page is JS-rendered with empty price spans.
// BUT the RTX 50 Series category grid (`/GeForce-RTX-50-Series?page=N`) is
// fully server-rendered: each `.product-layout` card has the title (a.title),
// link, image (img.img-responsive), price (span.price-new), and a stock
// button — `notify.showNotify(...)` ⇒ out of stock, `ADD TO CART` /
// `customsNNNN.showCustoms()` ⇒ in stock. This is the same surface bfms
// polls (direct product/category pages), so we mirror that approach instead
// of fighting the JS-rendered search page or a headless browser.
//
// The category lists every RTX 50 card MSI US sells (5050–5090, ~52 cards over
// 5 pages). One poll cycle's 6 MSI-US watches share a single scrape via a
// short-lived module cache (90s), so the 5 page fetches happen once per poll,
// not 6×. Each watch then filters the cached cards by its GPU model.

const US_CATEGORY = "GeForce-RTX-50-Series";
const US_CACHE_TTL_MS = 90_000;
const US_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Injectable HTML fetcher for us-store.msi.com. Akamai Bot Manager in front
 * of the US store fingerprints the TLS handshake and 403s Node's built-in
 * fetch (observed 2026-10: every MSI US poll returned 0 listings for days).
 * The poller injects its Chrome-TLS transport (`tlsFetchHtml`, got-scraping)
 * via `setMsiFetcher`, which passes the WAF in a single ~0.6s request. Without
 * an injected fetcher we fall back to plain fetch (works only from IPs Akamai
 * hasn't flagged).
 */
export type MsiHtmlFetcher = (url: string, signal?: AbortSignal) => Promise<string>;
let usFetcher: MsiHtmlFetcher | null = null;
export function setMsiFetcher(fn: MsiHtmlFetcher): void {
  usFetcher = fn;
}

interface UsCard {
  title: string;
  href: string;
  image: string;
  price: number | null;
  status: StockStatus;
  sku: string;
}

let usCache: { host: string; at: number; cards: UsCard[] } | null = null;
/** In-flight scrape, so the 6 US search watches firing together share ONE
 *  category crawl instead of each crawling 5–8 pages (single-flight). */
let usInflight: { host: string; p: Promise<UsCard[]> } | null = null;

/** Scrape (and cache) all RTX 50 cards from the US category grid, then filter
 *  to the ones matching `query`'s GPU model. */
async function searchUsStore(
  query: string,
  opts: SearchOptions,
  host: string,
  maxResults: number,
): Promise<Listing[]> {
  const cards = await usCards(host, opts.signal);
  const matches = modelMatcher(query);
  const out: Listing[] = [];
  for (const c of cards) {
    if (!/GeForce/i.test(c.title)) continue;
    if (!matches(c.title)) continue;
    out.push(usCardToListing(c, host));
    if (out.length >= maxResults) break;
  }
  return out;
}

/** Fetch every category page once (cached 90s) and parse all cards.
 *  Single-flight: concurrent callers await the same crawl. Pages are fetched
 *  in parallel batches of 4 (the grid is ~5 pages), stopping at the first
 *  short/empty page. */
async function usCards(host: string, signal?: AbortSignal): Promise<UsCard[]> {
  if (usCache && usCache.host === host && Date.now() - usCache.at < US_CACHE_TTL_MS) {
    return usCache.cards;
  }
  if (usInflight && usInflight.host === host) return usInflight.p;
  const p = crawlUsCards(host, signal).finally(() => {
    if (usInflight?.p === p) usInflight = null;
  });
  usInflight = { host, p };
  return p;
}

async function crawlUsCards(host: string, signal?: AbortSignal): Promise<UsCard[]> {
  const all: UsCard[] = [];
  const BATCH = 4;
  for (let first = 1; first <= 8; first += BATCH) {
    const pages = Array.from({ length: BATCH }, (_, i) => first + i).filter((p) => p <= 8);
    const htmls = await Promise.all(
      pages.map((page) => fetchUsHtml(`https://${host}/${US_CATEGORY}?page=${page}`, signal)),
    );
    let done = false;
    for (const html of htmls) {
      if (!html) {
        done = true;
        break;
      }
      const $ = cheerio.load(html);
      const cards = $(".product-layout").toArray();
      if (cards.length === 0) {
        done = true;
        break;
      }
      for (const el of cards) {
        const c = parseUsCard($(el));
        if (c) all.push(c);
      }
      if (cards.length < 12) {
        done = true; // last page (e.g. page 5 has 4)
        break;
      }
    }
    if (done) break;
  }
  // Only cache a real result; a crawl that failed outright shouldn't pin
  // "no cards" for 90s on the sibling watches.
  if (all.length > 0) usCache = { host, at: Date.now(), cards: all };
  return all;
}

async function fetchUsHtml(url: string, signal?: AbortSignal): Promise<string | null> {
  if (usFetcher) {
    try {
      return await usFetcher(url, signal);
    } catch (err) {
      console.warn(`[msi-us] fetch failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": US_UA, "Accept-Language": "en-US,en;q=0.9" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      console.warn(`[msi-us] ${url} -> HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`[msi-us] fetch failed:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseUsCard(el: cheerio.Cheerio<any>): UsCard | null {
  const title =
    el.find("a.title").first().text().trim() ||
    el.find("img.img-responsive").attr("alt")?.trim() ||
    "";
  if (!title) return null;
  const href = el.find("a.title").attr("href") || "";
  const image = el.find("img.img-responsive").attr("src") || "";
  const price = parseUsPrice(el.find("span.price-new").first().text());

  const btn = el.find(".button button").first();
  const onclick = btn.attr("onclick") || "";
  const cls = btn.attr("class") || "";
  const btnText = btn.text().trim();

  // `notify.showNotify(...)` or class `add-cart-button-4` ⇒ out of stock;
  // `ADD TO CART` / `customsNNNN.showCustoms()` / `add-cart-button-[123]` ⇒ in.
  let status: StockStatus = "out_of_stock";
  if (/notify\.showNotify/.test(onclick) || /\badd-cart-button-4\b/.test(cls)) {
    status = "out_of_stock";
  } else if (/ADD\s+TO\s+CART/i.test(btnText) || /customs\d+\.showCustoms/.test(onclick) || /add-cart-button-[123]\b/.test(cls)) {
    status = "in_stock";
  }

  let sku = "";
  const m =
    onclick.match(/notify\.showNotify\("(\d+)"/) ||
    onclick.match(/cart\.add\('(\d+)'/) ||
    onclick.match(/customs(\d+)\.showCustoms/) ||
    cls.match(/add-cart-button-(\d+)/);
  if (m) sku = m[1] ?? "";

  return { title, href, image, price, status, sku };
}

function parseUsPrice(text: string): number | null {
  const m = text.replace(/[^0-9.]/g, "");
  if (!m) return null;
  const n = Number.parseFloat(m);
  return Number.isFinite(n) ? n : null;
}

function usCardToListing(c: UsCard, host: string): Listing {
  return {
    retailer: "msi",
    title: c.title,
    canonicalTitle: normalizeGpuTitle(c.title, "MSI"),
    url: c.href || `https://${host}/${US_CATEGORY}`,
    price: c.price,
    originalPrice: null, // category card has no compare-at price; enrich later if needed
    discountAmount: null,
    shipping: null,
    status: c.status,
    seller: "MSI",
    firstParty: true,
    condition: RENEWED_OR_REFURBISHED_RE.test(c.title) ? "refurbished" : "new",
    sku: c.sku,
    imageUrl: c.image,
    raw: { currency: "USD", source: "us-store-category" },
  };
}

// --- MSI US — single product page ---------------------------------------------
//
// Product pages (`https://us-store.msi.com/<Slug>`) are server-rendered. The
// product's own identity/state lives in a handful of stable hooks:
//   - `input[name=product_id]`  → the store's numeric product id (our SKU; the
//                                 same id the category grid buttons carry)
//   - `#imagePopup[title|src]`  → title + main image
//   - `#prices-new` / `.prices-old` → current / struck-through price
//   - stock: the page's buttons reference the product id in their onclick —
//     `notify.showNotify("<id>", …)` ⇒ out of stock ("Notify Me");
//     `cart.add('<id>')` / `customs<id>.showCustoms()` ⇒ in stock ("ADD TO
//     CART"). Checking by id (not by position) is what keeps the related-
//     products carousel on the same page from being mistaken for the product.

async function checkUsProduct(url: string, host: string, signal?: AbortSignal): Promise<Listing | null> {
  // Drop tracking params (`?search=5090&limit=100`) so the stored URL is canonical.
  const clean = canonicalUsUrl(url);
  const html = await fetchUsHtml(clean, signal);
  if (!html) return null;
  const $ = cheerio.load(html);

  const sku = $("input[name=product_id]").attr("value")?.trim() ?? "";
  const img = $("#imagePopup").first();
  const title =
    img.attr("title")?.trim() ||
    img.attr("alt")?.trim() ||
    $("title").text().replace(/\s*-\s*MSI-US Official Store.*$/i, "").replace(/^MSI\s+/i, "").trim();
  if (!title) return null;

  const price = parseUsPrice($("#prices-new").first().text() || $(".prices-new").first().text());
  const oldPrice = parseUsPrice($(".prices-old").first().text());
  const originalPrice = oldPrice != null && price != null && oldPrice > price ? oldPrice : null;
  const discountAmount =
    originalPrice != null && price != null ? Math.round((originalPrice - price) * 100) / 100 : null;

  let status: StockStatus = "unknown";
  if (sku) {
    const esc = sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const notifyRe = new RegExp(`notify\\.showNotify\\(\\s*["']${esc}["']`);
    const cartRe = new RegExp(`cart\\.add\\(\\s*["']${esc}["']\\)|customs${esc}\\.showCustoms`);
    if (notifyRe.test(html)) status = "out_of_stock";
    else if (cartRe.test(html)) status = "in_stock";
  }
  if (status === "unknown") {
    // Fallback: the product's own (non-card) button sits outside `.product-layout`.
    const main = $("button.add-cart-button, button[class*='add-cart-button-']")
      .filter((_, el) => $(el).closest(".product-layout").length === 0)
      .first();
    const t = main.text().trim();
    const oc = main.attr("onclick") ?? "";
    if (/notify/i.test(t + oc)) status = "out_of_stock";
    else if (/ADD\s+TO\s+CART/i.test(t) || /showCustoms|cart\.add/.test(oc)) status = "in_stock";
  }

  return {
    retailer: "msi",
    title,
    canonicalTitle: normalizeGpuTitle(title, "MSI"),
    url: clean,
    price,
    originalPrice,
    discountAmount,
    shipping: null,
    status,
    seller: "MSI",
    firstParty: true,
    condition: "new",
    sku,
    imageUrl: img.attr("src") ?? "",
    raw: { currency: "USD", source: "us-store-product", host },
  };
}

/** Strip query/hash and percent-encode stray spaces in MSI US product URLs
 *  (the search grid links e.g. `/GeForce-RTX 5090-32G-SUPRIM-LIQUID-SOC`). */
export function canonicalUsUrl(url: string): string {
  try {
    const u = new URL(url.trim().replace(/ /g, "%20"));
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return url.trim();
  }
}

/** Build a predicate that matches a card title against the watch query's GPU
 *  model, so "RTX 5060" excludes "RTX 5060 Ti" and vice-versa. */
function modelMatcher(query: string): (title: string) => boolean {
  const m = query.match(/RTX\s*(50\d{2})\s*(Ti)?/i);
  if (!m) return () => true;
  const num = m[1]!;
  const wantTi = !!m[2];
  const re = wantTi
    ? new RegExp(`RTX\\s*${num}\\s+Ti`, "i")
    : new RegExp(`RTX\\s*${num}(?!\\s*Ti)`, "i");
  return (title) => re.test(title);
}
