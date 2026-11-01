import * as cheerio from "cheerio";

import type { Listing, RetailerAdapter, SearchOptions, StockStatus } from "@stockwatch/types";

import { normalizeGpuTitle } from "../normalize";

/**
 * LDLC adapter — one of France's top PC-component specialists (groupe LDLC
 * owns LDLC, TopAchat, Materiel.net). LDLC's search returns clean server-rendered
 * HTML with `.pdt-item` product cards, so this is a straightforward cheerio
 * scrape (no WAF, no JS-only render). Prices are in EUR with a French format
 * ("1 449€95" ⇒ €1449.95: space = thousands separator, € separates integer
 * from the 2-decimal cents). LDLC sells direct, so every listing is first-party.
 *
 * Reachability was probed empirically: `https://www.ldlc.com/recherche/<q>/`
 * returns HTTP 200 with 48 product cards for an "rtx 5070" query — no Akamai/
 * Cloudflare wall, no consent redirect. The search path is URL-encoded with
 * `+` for spaces (LDLC accepts both `+` and `%20`).
 */
export class LdlcAdapter implements RetailerAdapter {
  readonly id = "ldlc";
  readonly displayName = "LDLC";

  private get host(): string {
    return (process.env.LDLC_HOST ?? "www.ldlc.com").replace(/^https?:\/\//, "");
  }

  async search(query: string, opts: SearchOptions = {}): Promise<Listing[]> {
    const maxPages = opts.maxPages ?? 2;
    const maxResults = opts.maxResults ?? 60;
    const host = (opts.host ?? this.host).replace(/^https?:\/\//, "");
    const q = encodeURIComponent(query).replace(/%20/g, "+");

    const out: Listing[] = [];
    for (let page = 1; page <= maxPages && out.length < maxResults; page++) {
      const url =
        page === 1
          ? `https://${host}/recherche/${q}/`
          : `https://${host}/recherche/${q}/?page=${page}`;
      const html = await fetchHtml(url, opts.signal);
      if (!html) break;
      const $ = cheerio.load(html);
      const cards = $(".pdt-item").toArray();
      if (cards.length === 0) break; // no more results
      for (const el of cards) {
        const listing = normalizeCard($(el), host);
        if (!listing) continue;
        // Keep only graphics cards: LDLC lists cards, waterblocks, brackets…
        // Require "GeForce" (or "Radeon") so non-card hits drop out, matching
        // the MSI/Newegg adapters' first-party-card filter.
        if (!/GeForce|Radeon/i.test(listing.title)) continue;
        if (opts.firstPartyOnly && !listing.firstParty) continue;
        out.push(listing);
        if (out.length >= maxResults) break;
      }
    }
    return out;
  }

  async checkProduct(url: string, opts: SearchOptions = {}): Promise<Listing | null> {
    const html = await fetchHtml(url, opts.signal);
    if (!html) return null;
    const $ = cheerio.load(html);
    // Product detail pages use a different layout; best-effort extract from
    // the page's structured title/price. Kept minimal — the poller uses
    // `search`, not `checkProduct`, for its polling loop.
    const title = $("h1").first().text().trim();
    if (!title) return null;
    const price = parseFrPrice($(".price").first().text() || $(".pdt-price").first().text());
    const sku = $("[data-product-id]").first().attr("data-product-id") ?? "";
    return {
      retailer: this.id,
      title,
      canonicalTitle: normalizeGpuTitle(title, brandFrom(title)),
      url,
      price,
      originalPrice: null,
      discountAmount: null,
      shipping: null,
      status: price != null ? "in_stock" : "out_of_stock",
      seller: "LDLC",
      firstParty: true,
      condition: "new",
      sku,
      imageUrl: $("img").first().attr("src") ?? "",
      raw: null,
    };
  }
}

// --- Fetch ------------------------------------------------------------------

/** Injectable transport (the poller supplies a Chrome-TLS fetcher). From
 *  cloud runners LDLC's edge holds Node-TLS connections open until our
 *  timeout — every poll was a 12s hang — while a Chrome fingerprint is
 *  answered in ~1s. */
export type LdlcHtmlFetcher = (url: string, signal?: AbortSignal) => Promise<string>;
let injectedFetcher: LdlcHtmlFetcher | null = null;
export function setLdlcFetcher(fn: LdlcHtmlFetcher): void {
  injectedFetcher = fn;
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<string | null> {
  if (injectedFetcher) {
    try {
      return await injectedFetcher(url, signal);
    } catch (err) {
      console.warn(`[ldlc] fetch failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      console.warn(`[ldlc] ${url} -> HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`[ldlc] fetch failed:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- Normalize --------------------------------------------------------------

function normalizeCard($el: cheerio.Cheerio<any>, host: string): Listing | null {
  const title = $el.find(".pdt-desc h3 a").first().text().trim() || $el.find("a[title]").first().attr("title") || "";
  if (!title) return null;
  const href = $el.find(".pdt-desc a").first().attr("href") || $el.find("a").first().attr("href") || "";
  const url = href ? `https://${host}${href}` : "";
  const price = parseFrPrice($el.find(".price").first().text());
  // LDLC occasionally shows a strikethrough "was" price (`.barre` / `<del>`).
  const originalPrice = parseFrPrice(
    $el.find(".price.barre, del, .old-price, .price-was").first().text() || "",
  );
  const discountAmount =
    originalPrice != null && price != null && originalPrice > price
      ? Math.round((originalPrice - price) * 100) / 100
      : null;

  // Stock: LDLC encodes availability as `data-stock-web` on a per-card div.
  //   "1" = En stock (in stock now)
  //   "4" = Sous 7 jours (backorder — ships in ~7 days; NOT in stock now)
  //   "9" = Rupture (depleted / out of stock)
  //   "0" = out of stock
  // For a "buy it now" tracker, backorder counts as out of stock.
  const stockWeb = $el.find("[data-stock-web]").first().attr("data-stock-web");
  let status: StockStatus;
  if (stockWeb === "1") status = "in_stock";
  else if (stockWeb === "0" || stockWeb === "4" || stockWeb === "9") status = "out_of_stock";
  else status = "unknown";

  const sku = $el.attr("data-id") ?? $el.find("[data-product-id]").first().attr("data-product-id") ?? "";
  let image = $el.find("img").first().attr("src") ?? $el.find("img").first().attr("data-src") ?? "";
  // Bump the thumbnail to a larger crop (r150 → r500) for a crisper card image.
  if (image) image = image.replace(/\/r150\//, "/r500/");

  return {
    retailer: "ldlc",
    title,
    canonicalTitle: normalizeGpuTitle(title, brandFrom(title)),
    url,
    price,
    originalPrice,
    discountAmount,
    shipping: null,
    status,
    seller: "LDLC",
    firstParty: true,
    condition: "new",
    sku,
    imageUrl: image,
    raw: { currency: "EUR" },
  };
}

/** Parse a French-format price string into a number.
 *  "1 449€95" ⇒ 1449.95 ; "529€95" ⇒ 529.95 ; "449€" ⇒ 449 ; "1 449,95 €" ⇒ 1449.95. */
function parseFrPrice(s: string): number | null {
  if (!s) return null;
  // Pull the numeric chunk up to the first € (or end), keeping spaces/digits/commas/dots.
  const m = s.match(/([\d\s.,]+)\s*€?\s*(\d{2})?/);
  if (!m) return null;
  let intPart = (m[1] || "").replace(/[^\d]/g, "");
  let dec = m[2] ?? "";
  // Handle "1 449,95 €" (comma decimal) — if there's a comma/dot before €, split there.
  const alt = s.match(/([\d\s]*?)\s*([.,])\s*(\d{2})\s*€/);
  if (alt) {
    intPart = (alt[1] ?? "").replace(/[^\d]/g, "");
    dec = alt[3] ?? "";
  }
  if (!intPart) return null;
  const value = Number(intPart) + (dec ? Number(dec) / 100 : 0);
  return Number.isFinite(value) ? value : null;
}

/** Best-effort brand extraction from a listing title (first token, e.g. "ASUS"). */
function brandFrom(title: string): string {
  return title.trim().split(/\s+/)[0] ?? "";
}
