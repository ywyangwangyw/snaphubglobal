import * as cheerio from "cheerio";
import type { Listing, RetailerAdapter, SearchOptions, StockStatus } from "@stockwatch/types";

import { RateLimitError } from "../errors";
import { RENEWED_OR_REFURBISHED_RE } from "../gpu-catalog";
import { normalizeGpuTitle } from "../normalize";

/**
 * Amazon adapter. Amazon has per-country storefronts (amazon.com / .ca /
 * .co.uk / .de / .fr) that serve search results as server-rendered HTML — no
 * JSON API. We fetch `/s?k=<query>` with a realistic desktop User-Agent and
 * parse product cards with cheerio.
 *
 * Reachability (probed 2026-09): amazon.com, amazon.ca, amazon.de return full
 * search HTML; amazon.co.uk / amazon.fr serve a JS-only GDPR consent wall that
 * no server client can pass, so they're not seeded. Amazon varies its response
 * under repeated probing (soft blocks); a 429/503 or an empty/consent page is
 * treated as a poll failure so the poller's success-rate metrics surface it.
 *
 * Card fields: ASIN (`data-asin` / `/dp/ASIN`), title (`img.s-image` alt),
 * image, inline price (`.a-price .a-offscreen`). Amazon US often hides the
 * price on the card ("See options"); with `enrichDetails` we fetch each card's
 * product page to recover price + seller + stock (best-effort, capped).
 * First-party = "Ships from and sold by Amazon".
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_HOST = "www.amazon.com";

const CURRENCY_BY_HOST: Record<string, string> = {
  "www.amazon.com": "USD",
  "www.amazon.ca": "CAD",
  "www.amazon.co.uk": "GBP",
  "www.amazon.de": "EUR",
  "www.amazon.fr": "EUR",
};

export class AmazonAdapter implements RetailerAdapter {
  readonly id = "amazon";
  readonly displayName = "Amazon";

  async search(query: string, opts: SearchOptions = {}): Promise<Listing[]> {
    const maxPages = opts.maxPages ?? 2;
    const maxResults = opts.maxResults ?? 20;
    const host = (opts.host ?? DEFAULT_HOST).replace(/^https?:\/\//, "");
    const out: Listing[] = [];

    for (let page = 1; page <= maxPages && out.length < maxResults; page++) {
      const url = `https://${host}/s?k=${encodeURIComponent(query)}&page=${page}`;
      const html = await fetchAmazonHtml(url, opts.signal);
      const cards = parseCards(html, host);
      if (cards.length === 0) break;
      let added = 0;
      for (const card of cards) {
        // Renewed / refurbished cards are kept and flagged via
        // `card.condition`; the poller stores it and the UI badges them.
        // Amazon search for "rtx 5060" also returns cables/cases/monitors;
        // require "GeForce" to keep only graphics cards.
        if (!/GeForce/i.test(card.title)) continue;
        if (opts.firstPartyOnly && !card.firstParty) continue;
        out.push(card);
        added++;
        if (out.length >= maxResults) break;
      }
      // Diminishing returns: Amazon's relevance drops off a cliff after the
      // first page or two (a "rtx 5090" search nets ~15 cards total, then
      // cables/monitors). Each extra page is a full WAF-guarded request, so
      // stop once a page contributes fewer than a handful of cards.
      if (added === 0 || (page >= 2 && added < 4)) break;
    }

    return opts.enrichDetails ? await this.enrich(out, opts, host) : out;
  }

  async checkProduct(url: string, opts: SearchOptions = {}): Promise<Listing | null> {
    const host = (opts.host ?? safeHost(url) ?? DEFAULT_HOST).replace(/^https?:\/\//, "");
    const html = await fetchAmazonHtml(url, opts.signal);
    return parseProductPage(html, host, url);
  }

  /** Best-effort product-page enrichment for cards missing price/seller. */
  private async enrich(listings: Listing[], opts: SearchOptions, host: string): Promise<Listing[]> {
    const limit = 6;
    const targets = listings
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.price == null || !l.firstParty)
      .slice(0, limit);
    await mapPool(targets, 2, async ({ l, i }) => {
      try {
        const html = await fetchAmazonHtml(l.url, opts.signal);
        const d = parseProductPage(html, host, l.url);
        if (!d) return;
        listings[i] = {
          ...l,
          price: d.price ?? l.price,
          status: d.status !== "unknown" ? d.status : l.status,
          seller: d.seller ?? l.seller,
          firstParty: d.firstParty || l.firstParty,
          originalPrice: d.originalPrice ?? l.originalPrice,
          discountAmount: d.discountAmount ?? l.discountAmount,
        };
      } catch {
        /* leave original */
      }
    });
    return listings;
  }
}

// --- Fetch ------------------------------------------------------------------

/**
 * HTML transport for Amazon storefronts. Defaults to a plain undici fetch, but
 * the poller overrides it (via `setAmazonHtmlFetcher`) with a WAF-aware
 * transport that falls back to a headless browser for storefronts behind a
 * JS bot challenge (Amazon FR/DE Akamai). Keeping this injectable means the
 * adapters package has no Playwright dependency — only the poller does, so the
 * web app's bundle stays light.
 */
type HtmlFetcher = (url: string, signal?: AbortSignal) => Promise<string>;

let htmlFetcher: HtmlFetcher = defaultFetchAmazonHtml;

/** Override the HTML transport (used by the poller to inject a WAF-bypass). */
export function setAmazonHtmlFetcher(fn: HtmlFetcher): void {
  htmlFetcher = fn;
}

async function fetchAmazonHtml(url: string, signal?: AbortSignal): Promise<string> {
  return htmlFetcher(url, signal);
}

/** Default transport: undici fetch with rate-limit + soft-block detection. */
async function defaultFetchAmazonHtml(url: string, signal?: AbortSignal): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": UA,
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (res.status === 429 || res.status === 503) {
      throw new RateLimitError({ status: res.status, url });
    }
    if (!res.ok) throw new Error(`amazon HTTP ${res.status} for ${url}`);
    const body = await res.text();
    // Amazon EU WAF/consent wall: tiny page (meta-refresh Akamai `bm-verify`,
    // or AWS WAF `gokuProps`) with no product cards. Throw a sentinel so the
    // poller's transport can fall back to a browser that solves the challenge.
    if (isWafWall(body)) throw new WafChallengeError(`amazon WAF challenge for ${url}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** Detect Amazon's WAF/consent interstitial (Akamai Bot Manager or AWS WAF
 *  goku) — a tiny page that no server client can render into results. */
export function isWafWall(body: string): boolean {
  if (body.length >= 5_000) return false;
  return (
    /<meta http-equiv="refresh"/i.test(body) ||
    /awsWafCookieDomainList|gokuProps/i.test(body) ||
    /api-services-support@amazon/i.test(body)
  );
}

/** Thrown when Amazon serves a WAF/consent JS challenge instead of results.
 *  The poller's transport catches this and retries via a headless browser,
 *  or rethrows it (with a actionable message) when the challenge can't be
 *  solved so the failure is recorded in poll_metrics. */
export class WafChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WafChallengeError";
  }
}

// --- Parse: search cards ----------------------------------------------------

function parseCards(html: string, host: string): Listing[] {
  const $ = cheerio.load(html);
  const out: Listing[] = [];
  const currency = CURRENCY_BY_HOST[host] ?? null;

  $('div[data-component-type="s-search-result"]').each((_, el) => {
    const $c = $(el);
    const asin = $c.attr("data-asin") || asinFromHref($c);
    if (!asin) return;
    const img = $c.find("img.s-image").first();
    const title = (img.attr("alt") || $c.find("h2 span").first().text() || "").trim();
    if (!title) return;
    const priceText = $c.find(".a-price .a-offscreen").first().text().trim();
    const price = parsePrice(priceText);
    const cardText = $c.text();
    const status = stockFromText(cardText);
    const firstParty = /Ships from and sold by Amazon|Sold by Amazon/i.test(cardText);
    const isRenewed = RENEWED_OR_REFURBISHED_RE.test(title) || RENEWED_OR_REFURBISHED_RE.test(cardText);

    out.push({
      retailer: "amazon",
      title,
      canonicalTitle: normalizeGpuTitle(title),
      url: `https://${host}/dp/${asin}`,
      price,
      originalPrice: null,
      discountAmount: null,
      shipping: null,
      status,
      seller: firstParty ? "Amazon" : null,
      firstParty,
      condition: isRenewed ? "refurbished" : "new",
      sku: asin,
      imageUrl: img.attr("src") || "",
      raw: { asin, currency, source: "search" },
    });
  });
  return out;
}

function asinFromHref($c: cheerio.Cheerio<any>): string {
  const href = $c.find('a[href*="/dp/"]').first().attr("href") || "";
  const m = href.match(/\/dp\/([A-Z0-9]{10})/);
  return m ? (m[1] ?? "") : "";
}

function stockFromText(text: string): StockStatus {
  if (/Currently unavailable|Out of Stock|Temporarily out of stock/i.test(text)) return "out_of_stock";
  if (/In Stock|in stock|Only \d+ left|left in stock/i.test(text)) return "in_stock";
  return "unknown";
}

// --- Parse: product page ----------------------------------------------------

function parseProductPage(html: string, host: string, url: string): Listing | null {
  const $ = cheerio.load(html);
  const currency = CURRENCY_BY_HOST[host] ?? null;
  const title = ($("#productTitle").text() || "").trim();
  if (!title) return null;
  const imageUrl = ($("#landingImage").attr("src") || $("#imgBlkFront").attr("src") || "").trim();
  const priceText =
    $("#corePrice_feature_div .a-offscreen").first().text() ||
    $("#priceblock_ourprice").text() ||
    $("#priceblock_dealprice").text() ||
    $(".a-price .a-offscreen").first().text() ||
    "";
  const price = parsePrice(priceText.trim());
  const listPriceText = $("#corePrice_feature_div .a-text-price .a-offscreen").first().text() || "";
  const originalPrice = parsePrice(listPriceText.trim());
  const availText = $("#availability").text() || "";
  const status = stockFromText(availText);
  const sellerText = $("#sellerProfileTriggerId").text().trim();
  const pageText = $("body").text();
  const firstParty = /Ships from and sold by Amazon|Sold by Amazon/i.test(pageText);
  const asin = (url.match(/\/dp\/([A-Z0-9]{10})/) || [])[1] || "";
  const isRenewed = RENEWED_OR_REFURBISHED_RE.test(title) || RENEWED_OR_REFURBISHED_RE.test(pageText);

  return {
    retailer: "amazon",
    title,
    canonicalTitle: normalizeGpuTitle(title),
    url,
    price,
    originalPrice: originalPrice && price != null && originalPrice > price ? originalPrice : null,
    discountAmount:
      originalPrice && price != null && originalPrice > price
        ? Math.round((originalPrice - price) * 100) / 100
        : null,
    shipping: null,
    status,
    seller: firstParty ? "Amazon" : sellerText || null,
    firstParty,
    condition: isRenewed ? "refurbished" : "new",
    sku: asin,
    imageUrl,
    raw: { asin, currency, source: "product" },
  };
}

// --- Helpers ----------------------------------------------------------------

function parsePrice(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/\s/g, "").match(/([\d.,]+)/);
  if (!m) return null;
  let t = m[1]!;
  // Disambiguate US/UK "1,234.56" from EU "1.234,56".
  if (/,.*\./.test(t)) t = t.replace(/,/g, "");
  else if (/\..*,/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
}
