/**
 * Catalog model — two levels, built server-side from the latest snapshot of
 * every listing we track:
 *
 *   CatalogItem   The lowest level: one row per retailer product identifier
 *                 (Amazon ASIN, Newegg item number, Best Buy SKU, LDLC
 *                 reference, MSI store id). It carries identity only — name,
 *                 maker, model, type, manufacturer part number — never a
 *                 price. The same ASIN seen on amazon.com / .ca / .de is ONE
 *                 catalog item with several offers.
 *
 *   CatalogOffer  A catalog item at one storefront (country) in one
 *                 condition: price, currency, stock, URL. Newegg's `…R`
 *                 (open box) and `9UB…` (marketplace) item numbers are
 *                 offers on the base item, not separate items.
 *
 *   CatalogProduct The real-world thing — e.g. "ASUS ROG Astral RTX 5090
 *                 OC" — a group of catalog items sold by different retailers
 *                 / distributors. Items are matched by manufacturer part
 *                 number when any retailer exposes one, else by a variant
 *                 signature derived from the title (maker + product line +
 *                 VRAM + OC + colour/cooling modifiers). This is where
 *                 cross-retailer price and availability comparison lives.
 */
import { classifyGpuModel, extractGpuMpn, inferGpuBrand, looksLikeMpn } from "@stockwatch/adapters";

import type { ProductView, WatchView } from "./demo";
import type { UsdRates } from "./data";
import { canonicalMsiModelName, lookupMpn, type MpnSource } from "./mpn-db";

export type { MpnSource } from "./mpn-db";

export type CatalogType = "gpu" | "desktop" | "laptop" | "accessory" | "other";
export type CatalogCondition = NonNullable<WatchView["condition"]>;
/** What kind of identifier keys a catalog item. */
export type CatalogIdKind = "asin" | "item" | "sku" | "ref" | "url";

export interface CatalogOffer {
  retailer: string;
  country: string;
  /** The retailer's exact listing identifier (e.g. Newegg `14-126-816R`). */
  listingId: string;
  url: string;
  condition: CatalogCondition;
  inStock: boolean;
  status: WatchView["status"];
  price: number | null;
  currency: string | null;
  usd: number | null;
  seller: string | null;
  updatedAt: string | null;
}

export interface CatalogItem {
  /** `${retailer}:${id}` */
  key: string;
  retailer: string;
  id: string;
  idKind: CatalogIdKind;
  /** Manufacturer part number: from the retailer when it exposed one, else
   *  inherited from a sibling item or derived from the maker's naming scheme. */
  mpn: string | null;
  /** How `mpn` was established; null when no part number could be found. */
  mpnSource: MpnSource | null;
  name: string;
  maker: string;
  model: string;
  type: CatalogType;
  imageUrl: string | null;
  /** Key of the CatalogProduct this item belongs to. */
  productKey: string;
  offers: CatalogOffer[];
  inStock: number;
  /** The tracked product (search) this item was discovered under. */
  trackedProductId: string;
  trackedProductName: string;
}

export interface CatalogProduct {
  key: string;
  name: string;
  maker: string;
  model: string;
  type: CatalogType;
  /** Distinct manufacturer part numbers across the group's items. */
  mpns: string[];
  items: CatalogItem[];
  retailers: string[];
  countries: string[];
  conditions: CatalogCondition[];
  offers: number;
  inStock: number;
  /** Lowest in-stock price (USD) and where it is. */
  minUsd: number | null;
  minUsdRetailer: string | null;
  minUsdCountry: string | null;
  imageUrl: string | null;
  trackedProductName: string;
}

// --- Helpers ----------------------------------------------------------------

function toUsd(amount: number | null, currency: string | null, rates: UsdRates): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  if (!currency || currency === "USD") return amount;
  const r = rates.rates[currency];
  return !r || r <= 0 ? amount : amount / r;
}

/** Tidy a title for display: drop "Sponsored Ad -" prefixes, empty or
 *  unbalanced trailing parentheticals and dangling separators. */
export function cleanName(title: string): string {
  let t = title
    .replace(/^\s*Sponsored\s+Ad\s*[-–:]\s*/i, "")
    .replace(/^\s*(?:Refurbished|Renewed|Open\s+Box|Used)\s*[:\-–]\s*/i, "")
    .replace(/\s*\((?:Renewed|Refurbished|Certified\s+Refurbished)\)\s*/gi, " ")
    .replace(/\s*·\s*Occasion\s*$/i, "")
    .replace(/\(\s*EXCLUSIVIT[EÉ]\s+WEB\s*\)/i, "")
    .replace(/\(\s*[,/|-]*\s*\)/g, " ");
  // Spec tails the normalizer left behind: "… | SFF-Ready", "… — 16GB (30Gbps/)",
  // "… - 16GB", "…, Blackwell GPU, Cooling".
  t = t.split(/\s\|\s?|\s—\s|\s[-–]\s(?=\d{1,2}\s?GB\b)/)[0] ?? t;
  t = t.replace(/,\s+(?:Blackwell|Cooling|GPU|\d{1,2}\s?GB)\b.*$/i, "");
  const opens = (t.match(/\(/g) ?? []).length;
  const closes = (t.match(/\)/g) ?? []).length;
  if (opens > closes) t = t.slice(0, t.lastIndexOf("("));
  return t
    .replace(/[\s|,(\-–]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Brand named outright in a system/laptop/accessory title. */
const SYSTEM_BRANDS: [RegExp, string][] = [
  [/\bAlienware\b/i, "Alienware"],
  [/\bCyberPower(?:PC)?\b/i, "CyberPowerPC"],
  [/\biBUYPOWER\b/i, "iBUYPOWER"],
  [/\bSkytech\b/i, "Skytech"],
  [/\bLenovo\b|\bLegion\b|\bThinkPad\b|\bLOQ\b/i, "Lenovo"],
  [/\bDell\b/i, "Dell"],
  [/\bHP\b|\bOMEN\b|\bVictus\b/i, "HP"],
  [/\bAcer\b|\bPredator\b|\bNitro\b/i, "Acer"],
  [/\bRazer\b|\bBlade\b/i, "Razer"],
  [/\bCorsair\b|\bVengeance\b/i, "Corsair"],
  [/\bNZXT\b/i, "NZXT"],
  [/\bMaingear\b/i, "Maingear"],
  [/\bOrigin\s+PC\b/i, "Origin PC"],
  [/\bThermaltake\b/i, "Thermaltake"],
  [/\bSamsung\b/i, "Samsung"],
  [/\bMicrosoft\b|\bSurface\b/i, "Microsoft"],
  [/\bASUS\b|\bROG\b|\bTUF\b|\bZephyrus\b|\bStrix\b/i, "ASUS"],
  [/\bGIGABYTE\b|\bAORUS\b|\bAERO\b/i, "GIGABYTE"],
  [/\bMSI\b|\bKatana\b|\bRaider\b|\bStealth\b|\bVector\b|\bTitan\b|\bCyborg\b|\bCrosshair\b|\bAegis\b|\bInfinite\b|\bCodex\b|\bMEG\b|\bMPG\b|\bMAG\b/i, "MSI"],
  [/\bZOTAC\b|\bAMP\b|\bZBOX\b/i, "ZOTAC"],
  [/\bPNY\b|\bXLR8\b/i, "PNY"],
  // GPU product lines the shared normalizer doesn't map (too ambiguous there).
  [/\bDUAL\s+(?:GeForce\s+)?RTX\b/i, "ASUS"],
  [/\bEagle\b/i, "GIGABYTE"],
  [/\bGainward\b|\bPhoenix\b|\bPython\b/i, "Gainward"],
  [/\bPalit\b|\bGameRock\b|\bGamingPro\b/i, "Palit"],
  [/\bInno3D\b|\biChill\b/i, "Inno3D"],
  [/\bAlphacool\b/i, "Alphacool"],
  [/\bCyberGeek\b/i, "CyberGeek"],
];

/** Maker from a manufacturer part-number prefix, when the title lacks one. */
const MPN_PREFIX_BRANDS: [RegExp, string][] = [
  [/^ZT-/i, "ZOTAC"],
  [/^GV-/i, "GIGABYTE"],
  [/^VCG|^VCN/i, "PNY"],
  [/^(?:ROG|TUF|DUAL|PRIME|PROART|ASTRAL|STRIX)-/i, "ASUS"],
  [/^NE\d/i, "Palit"],
];

/** Storefronts that only sell their own brand. */
const FIRST_PARTY_MAKER: Record<string, string> = { msi: "MSI" };

/** Retailers whose `mpn` field is their own SKU / reference, never the
 *  manufacturer's part number. */
const RETAILER_OWN_SKU = new Set(["bestbuy", "msi", "ldlc"]);

/** Words that can lead a system title without being the builder's brand. */
const NOT_A_BRAND = new Set([
  "gaming", "pc", "desktop", "laptop", "computer", "custom", "new", "the", "prebuilt",
  "rtx", "geforce", "nvidia", "intel", "amd", "ryzen", "core", "high", "ultra", "premium",
  "powered", "liquid", "cooled", "mini", "tower", "mid", "full", "white", "black", "rgb",
  "renewed", "refurbished", "certified", "open", "box", "ad", "sponsored", "with", "copilot+",
]);

/** For prebuilt systems the builder is almost always the leading word(s). */
function leadingBrand(title: string): string {
  const head = cleanName(title).split(/\s[-–|:,(]\s|\s[-–|]|[|(]/)[0] ?? "";
  const words = head.trim().split(/\s+/);
  const first = words[0] ?? "";
  if (!/^[A-Za-z][A-Za-z0-9+&.']*$/.test(first) || NOT_A_BRAND.has(first.toLowerCase())) return "";
  const second = words[1] ?? "";
  if (/^[A-Z][a-z]{2,}$/.test(second) && !NOT_A_BRAND.has(second.toLowerCase()) && !/\d/.test(words[2] ?? "x")) {
    return `${first} ${second}`;
  }
  return first;
}

/** GPU product lines that belong to exactly one maker. Best Buy titles often
 *  lead with "NVIDIA" (or the wrong brand) and only the line word gives the
 *  maker away: "NVIDIA RTX 5060 Ti 16GB SHADOW 2X OC PLUS" is MSI. */
const EXCLUSIVE_LINE_BRANDS: [RegExp, string][] = [
  [/\b(?:SUPRIM|VENTUS|VANGUARD|INSPIRE|FRIEREN|GAMING\s+TRIO|SHADOW\s+[23]X|EXPERT|LIGHTNING)\b/i, "MSI"],
  [/\b(?:AORUS|WINDFORCE|EAGLE|AERO)\b/i, "GIGABYTE"],
  [/\b(?:ASTRAL|STRIX|PROART|NOCTUA|TUF|PRIME|DUAL(?![-\s]?(?:FAN|SLOT|BIOS)))\b/i, "ASUS"],
  [/\b(?:TWIN\s+EDGE|SOLID(?:\s+CORE)?|SOLO|AMP\s+(?:EXTREME|WHITE)|APOCALYPSE)\b/i, "ZOTAC"],
  [/\b(?:EPIC-?X|XLR8)\b/i, "PNY"],
];
/** Brands the shared normalizer doesn't know, so a stray "GIGABYTE" prefix
 *  on the Amazon title would otherwise win. */
const MINOR_GPU_BRANDS: [RegExp, string][] = [
  [/\bYeston\b/i, "Yeston"],
  [/\bCyberGeek\b/i, "CyberGeek"],
];
const AIB_NAMED_RE = /\b(?:ASUS|GIGABYTE|MSI|ZOTAC|PNY|EVGA|PALIT|INNO3D|GAINWARD|COLORFUL)\b/i;

/** Titles that describe a whole system rather than a card. */
export function looksLikeSystemTitle(title: string): boolean {
  return /\b(?:gaming\s+pc|desktop|laptop|notebook|gaming\s+computer|copilot\+\s*pc|\bpc\s+desktop|mini\s+pc|workstation)\b/i.test(title);
}

function inferMaker(title: string, mpn: string | null, type: CatalogType, retailer: string): string {
  const firstParty = FIRST_PARTY_MAKER[retailer];
  if (firstParty) return firstParty;
  const looksLikeSystem = looksLikeSystemTitle(title);
  if (type === "gpu" && !looksLikeSystem) {
    for (const [re, brand] of MINOR_GPU_BRANDS) if (re.test(title)) return brand;
    const named = AIB_NAMED_RE.test(title);
    for (const [re, brand] of EXCLUSIVE_LINE_BRANDS) {
      if (!re.test(title)) continue;
      // A brand named outright wins over a line word, except that MSI's
      // multi-word lines are unmistakable even when a retailer mislabels the
      // brand ("GIGABYTE … GAMING TRIO OC" on Best Buy is an MSI card).
      if (!named || (brand === "MSI" && /\b(?:GAMING\s+TRIO|VENTUS|SUPRIM|VANGUARD|SHADOW\s+[23]X)\b/i.test(title))) return brand;
      break;
    }
  }
  const gpuBrand = inferGpuBrand(title);
  if (gpuBrand && type === "gpu" && !looksLikeSystem) return gpuBrand;
  for (const [re, brand] of SYSTEM_BRANDS) if (re.test(title)) return brand;
  if (gpuBrand) return gpuBrand;
  if (mpn) for (const [re, brand] of MPN_PREFIX_BRANDS) if (re.test(mpn)) return brand;
  if (type === "desktop" || type === "laptop") return leadingBrand(title);
  return "";
}

// --- Identity ---------------------------------------------------------------

interface Identity {
  id: string;
  kind: CatalogIdKind;
  listingId: string;
}

const NEWEGG_ITEM_RE = /^(?:9U[A-Z])?(\d{2}-\d{3}-\d{3})[A-Z]?$/i;

/** Which retailer product the listing is, and the exact listing id. */
function identify(w: WatchView): Identity {
  const sku = (w.mpn ?? "").trim();
  const url = w.url ?? "";
  switch (w.retailer) {
    case "amazon": {
      const asin = url.match(/\/dp\/([A-Z0-9]{10})/i)?.[1] ?? (/^B0[A-Z0-9]{8}$/i.test(sku) ? sku : "");
      if (asin) return { id: asin.toUpperCase(), kind: "asin", listingId: asin.toUpperCase() };
      break;
    }
    case "newegg": {
      const item = url.match(/\/p\/([^/?#]+)/i)?.[1] ?? "";
      const base = item.match(NEWEGG_ITEM_RE)?.[1];
      if (base) return { id: base, kind: "item", listingId: item };
      if (item) return { id: item, kind: "item", listingId: item };
      break;
    }
    case "ldlc":
      if (sku) return { id: sku, kind: "ref", listingId: sku };
      break;
    case "bestbuy":
    case "msi":
      if (sku) return { id: sku, kind: "sku", listingId: sku };
      break;
  }
  if (sku) return { id: sku, kind: "sku", listingId: sku };
  return { id: url || w.watchId, kind: "url", listingId: url || w.watchId };
}

/** Part-number shapes `looksLikeMpn` (tuned for stripping codes out of
 *  titles) rejects but that retailers legitimately report in their model
 *  field: NVIDIA's "900-1G144-2545-000", PNY's hyphen-less "VCG50608DFXPB1",
 *  Gigabyte's low-profile "GV-N5060OC-8GL". */
const EXTRA_MPN_SHAPES: RegExp[] = [
  /^\d{3}-\d[A-Z0-9]{4}-\d{4}-\d{3}$/i, // NVIDIA Founders Edition
  /^(?:VCG|CR)\d{4}T?\d{1,2}[DT]FX{1,2}PB1(?:-O)?$/i, // PNY
  /^[A-Z]{2,4}\d{3,4}T?[A-Z]\d?[A-Z0-9]{6,}$/i, // PNY retailer-exclusive (KMR506TE5L8DT2A)
];

/** Accept a retailer's part-number / model field as the item's MPN. Newegg's
 *  "Model" is the manufacturer's identifier, which for MSI is the model name
 *  itself ("RTX 5080 16G GAMING TRIO OC") and for system builders a config
 *  code; Best Buy's and MSI's own store ids are retailer SKUs and rejected. */
function retailerMpn(sku: string, retailer: string, type: CatalogType): string | null {
  if (!sku) return null;
  if (looksLikeMpn(sku)) return sku;
  if (/^\d+(?:\.\d+)?$/.test(sku) || /^B0[A-Z0-9]{8}$/i.test(sku)) return null; // SKU number, price, ASIN
  if (type === "gpu") {
    const msiName = canonicalMsiModelName(sku);
    if (msiName) return msiName;
    for (const re of EXTRA_MPN_SHAPES) if (re.test(sku)) return sku.toUpperCase();
    return null;
  }
  // Systems: Newegg's model field is the builder's configuration code.
  if (retailer === "newegg" && /\d/.test(sku) && /[A-Z]/i.test(sku) && sku.length >= 6) return sku;
  return null;
}

/** MPN printed in a title. Amazon truncates titles at ~125 chars, so a part
 *  number near the end of a long title may be cut short ("GV-N5080AORUSM"):
 *  those come back as `truncated` so the caller can resolve them against
 *  part numbers other retailers reported in full. */
function titleMpn(title: string): { mpn: string; truncated: boolean } {
  const mpn = extractGpuMpn(title);
  if (!mpn) return { mpn: "", truncated: false };
  const end = title.lastIndexOf(mpn) + mpn.length;
  const truncated = title.length >= 120 && title.length - end <= 12;
  return { mpn, truncated };
}

function compactMpn(mpn: string): string {
  return mpn.toUpperCase().replace(/[\s_]+/g, "");
}

/** Strip a trailing hardware-revision suffix ("… G10") that some retailers
 *  append to the manufacturer part number. */
function stripRevision(mpn: string): string {
  return mpn.replace(/\s+G\d{2}$/i, "").trim();
}

/** Canonical MPN for grouping: case/space-insensitive, revision suffix
 *  dropped, PNY's "CR…" certified-refurbished prefix folded into "VCG…". */
function normMpn(mpn: string): string {
  return stripRevision(mpn)
    .toUpperCase()
    .replace(/^CR(\d{3})/, "VCG$1")
    .replace(/[\s_]+/g, "")
    .replace(/-?(\d{1,2})GD?$/, "-$1G");
}

/** The spelling to propagate when a product's items report the same part
 *  number in several forms: never a refurbished-stock prefix (PNY "CR…"),
 *  never a revision suffix, shortest otherwise. */
function canonicalSpelling(mpns: Array<string | null>): string | null {
  const known = mpns.filter((x): x is string => Boolean(x));
  if (known.length === 0) return null;
  const rank = (m: string) => (/^CR\d/i.test(m) ? 2 : 0) + (/\sG\d{2}$/i.test(m) ? 1 : 0);
  known.sort((a, b) => rank(a) - rank(b) || a.length - b.length);
  return known[0]!;
}

/** VRAM every SKU of a model ships with; "" where the model has variants. */
function defaultVram(model: string): string {
  switch (model) {
    case "RTX 5090": return "32";
    case "RTX 5080": return "16";
    case "RTX 5070 Ti": return "16";
    case "RTX 5070": return "12";
    case "RTX 5060": return "8";
    default: return "";
  }
}

function mpnVram(mpn: string): string {
  return mpn.toUpperCase().match(/-?O?(8|12|16|24|32)GD?\b/)?.[1] ?? "";
}

// --- Variant signature ------------------------------------------------------

/** Product-line / variant words that distinguish one card from another within
 *  a maker + model. Anything not listed here is treated as marketing noise. */
const LINE_TOKENS = new Set([
  // ASUS
  "ROG", "ASTRAL", "STRIX", "TUF", "PRIME", "PROART", "DUAL", "NOCTUA", "EVO", "BTF", "LC", "MATRIX",
  // GIGABYTE
  "AORUS", "MASTER", "XTREME", "WATERFORCE", "WB", "INFINITY", "WOOD", "ICE", "GAMING", "WINDFORCE",
  "AERO", "EAGLE", "SFF", "MAX", "V2",
  // MSI
  "SUPRIM", "SOC", "TRIO", "VENTUS", "3X", "2X", "SHADOW", "INSPIRE", "VANGUARD", "EXPERT", "DRACO",
  "EPIC", "LIGHTNING", "Z", "PLUS", "FRIEREN", "MLG", "LAUNCH", "PZ",
  // ZOTAC
  "AMP", "SOLID", "CORE", "TWIN", "EDGE", "SOLO", "ARCTICSTORM", "APOCALYPSE", "LP",
  // PNY
  "XLR8", "EPIC-X", "ARGB", "OVERTAKE", "SLIM",
  // Gainward / Palit / Inno3D
  "PHOENIX", "PHOENIX-S", "PYTHON", "III", "GS", "V1", "GAMEROCK", "GAMINGPRO", "ICHILL", "FROSTBITE", "X3",
  // NVIDIA
  "FOUNDERS",
  // Colours / generic variants
  "WHITE", "BLACK", "BUNDLE",
]);

/** Spelling variants → canonical token. */
const TOKEN_ALIASES: Record<string, string> = {
  EXTREME: "XTREME",
  LIQUID: "LC",
  "LOW-PROFILE": "LP",
  BLANC: "WHITE",
  WEISS: "WHITE",
  WEIß: "WHITE",
  NOIR: "BLACK",
  SCHWARZ: "BLACK",
  OVERCLOCKED: "OC",
  WINDFORCE3: "WINDFORCE",
  "WINDFORCE-3": "WINDFORCE",
};

/** Makers for which "GAMING" names a product line rather than being filler. */
const GAMING_IS_A_LINE = new Set(["GIGABYTE", "MSI"]);

/** Phrases to delete from a title before tokenising. Order matters a little. */
const TITLE_NOISE: RegExp[] = [
  /\bgaming\s+graphics?\s+cards?\b/gi,
  /\bgraphics?\s+cards?\s+gaming\b/gi,
  /\bcontent\s+creation\s+graphics?\s+cards?\b/gi,
  /\bgraphics?\s+cards?\b/gi,
  /\bvideo\s+cards?\b/gi,
  /\bgaming\s+cards?\b/gi,
  /\bgaming\s+quad\s+fan\b/gi,
  /\bquad[-\s]?fan\b|\btriple[-\s]?fan\b|\bdual[-\s]?fan\b|\btwin[-\s]?fan\b/gi,
  /\bwindforce\s+(?:hyperburst\s+)?cooling\s+system\b/gi,
  /\bcooling\s+system\b/gi,
  /\bsff[-\s]?ready\b|\bsff\s+compatible\b/gi,
  /\bedition\b|\bed\.\b/gi,
  /\bnvidia\b|\bgeforce\b|\bblackwell\b/gi,
  /\bgddr[67]x?\b/gi,
  /\bdlss\s*4(?:\.0)?\b|\breflex\s*2\b|\brtx\s+ai\b/gi,
  /\bpci[-\s]?e(?:xpress)?\s*(?:gen\s*)?[45](?:\.0)?\b|\bpcie\b/gi,
  /\b\d{3}[-\s]?bits?\b|\b\d+\s*gbps\b|\b\d+\s*gb\/s\b|\bx16\b/gi,
  /\b\d+(?:\.\d+)?[-\s]?slot\b/gi,
  /\bhdmi\b|\bdisplayport\b|\bdp\b|\busb\s+type-c®?\b/gi,
  /\b\d{3,4}\s*mhz\b|\bcore\s+(?:clock|frequency)\b|\bboost\s+(?:clock|frequency)\b/gi,
  /\bmilitary[-\s]grade\b|\baxial[-\s]tech\b/gi,
  /\b(?:ai\s+)?tops\b/gi,
  /\bbundle\s+of\b/gi,
];

interface Signature {
  model: string;
  maker: string;
  vram: string;
  oc: boolean;
  tokens: Set<string>;
}

/** Decode variant tokens hidden in a manufacturer part number. */
function mpnTokens(mpn: string, maker: string): string[] {
  const out: string[] = [];
  const up = mpn.toUpperCase();
  if (/\bO\d{1,2}G\b|-O\d{1,2}G/.test(up)) out.push("OC");
  if (maker === "ASUS") {
    // ROG-ASTRAL-RTX5080-O16G-WHITE-GAMING: "GAMING" is a suffix on every
    // ASUS gaming-line part number, not a variant.
    for (const part of up.split(/[-\s]+/)) {
      if (part !== "GAMING" && LINE_TOKENS.has(part)) out.push(part);
    }
  } else if (maker === "GIGABYTE") {
    // GV-N5080AORUS M-16GD → AORUS, MASTER. Middle = between model and -16GD.
    const mid = up.replace(/^GV-N\d{3,4}T?/, "").replace(/-?\d{1,2}GD?(?:\s+G\d{2})?$/, "").trim();
    const expanded = mid
      .replace(/^(AORUS|EAGLE|AERO|GAMING|WF[23])(?=[A-Z])/, "$1 ")
      .replace(/\b(WF[23])/, "WINDFORCE ")
      .replace(/\bOC\b/, " OC ")
      .replace(/([A-Z])OC\b/, "$1 OC");
    const codes: Record<string, string> = { M: "MASTER", IF: "INFINITY", X: "XTREME", W: "WATERFORCE", MAX: "MAX", WB: "WB", ICE: "ICE", OC: "OC", V2: "V2" };
    for (const part of expanded.split(/\s+/).filter(Boolean)) {
      const tok = codes[part] ?? part;
      if (tok === "OC") out.push("OC");
      else if (LINE_TOKENS.has(tok)) out.push(tok);
    }
  } else if (maker === "MSI") {
    // "RTX 5080 16G SUPRIM LIQUID SOC" → SUPRIM, LC, SOC (+ OC).
    for (const part of up.split(/\s+/)) {
      const tok = TOKEN_ALIASES[part] ?? part;
      if (tok === "OC" || tok === "SOC") out.push("OC");
      if (tok !== "OC" && LINE_TOKENS.has(tok)) out.push(tok);
    }
  }
  return out;
}

function signatureOf(title: string, mpn: string | null, model: string, maker: string): Signature {
  const makerUp = maker.toUpperCase();
  // Bundles (card + PSU / holder) are not the card.
  const isBundle = /\bbundle\b/i.test(title) || /\s\+\s/.test(title);
  const clean = cleanName(title);
  let head = clean;
  // Keep only the product phrase before spec noise.
  head = head.split(/\s[|(]|\s-\s|\s–\s|,\s|\s·\s|\s\+\s/)[0] ?? head;
  for (const re of TITLE_NOISE) head = head.replace(re, " ");
  head = head.replace(/\bTUF\s+Gaming\b/gi, "TUF").replace(/\bZOTAC\s+Gaming\b/gi, "ZOTAC");

  const vram = (head.match(/\b(8|12|16|24|32)\s?G(?:B)?\b/i)?.[1] ?? "").toString();
  // "OC" may sit after a comma ("… Slim Dual-Fan, Dual-Slot OC"), so look at
  // the whole cleaned title for it.
  let oc = /\bS?OC\b/i.test(clean) || /\boverclocked\b/i.test(clean);
  const tokens = new Set<string>();
  let hyphenVram = "";
  for (const raw of head.toUpperCase().split(/[\s/]+/)) {
    const word = raw.replace(/^[^A-Z0-9-]+|[^A-Z0-9-]+$/g, "");
    if (!word) continue;
    const tok = TOKEN_ALIASES[word] ?? word;
    if (tok === "OC") { oc = true; continue; }
    if (tok === "GAMING" && !GAMING_IS_A_LINE.has(makerUp)) continue;
    if (tok === makerUp) continue;
    if (LINE_TOKENS.has(tok)) { tokens.add(tok); continue; }
    // A part-number fragment glued into the title ("Prime -Rtx5070-O12G-White")
    // still carries variant words; split it when it has digits in it.
    if (word.includes("-") && /\d/.test(word)) {
      for (const part of word.split("-")) {
        const m = part.match(/^(O?)(8|12|16|24|32)GD?$/);
        if (m) {
          if (m[1]) oc = true;
          hyphenVram = hyphenVram || m[2]!;
          continue;
        }
        const ptok = TOKEN_ALIASES[part] ?? part;
        if (ptok === "GAMING" && !GAMING_IS_A_LINE.has(makerUp)) continue;
        if (LINE_TOKENS.has(ptok)) tokens.add(ptok);
      }
    }
  }
  if (mpn) {
    for (const tok of mpnTokens(mpn, maker)) {
      if (tok === "OC") oc = true;
      else tokens.add(tok);
    }
  }
  if (isBundle) tokens.add("BUNDLE");
  // Sub-brands imply their parent line even when a title omits it.
  if (tokens.has("ASTRAL") || tokens.has("STRIX") || tokens.has("MATRIX")) tokens.add("ROG");
  const resolvedVram = vram || hyphenVram || (mpn ? mpnVram(mpn) : "") || defaultVram(model);
  return { model, maker: makerUp, vram: resolvedVram, oc, tokens };
}

/** Title-case a variant token for display ("WATERFORCE" → "Waterforce",
 *  acronyms kept upper). */
function tokenLabel(tok: string): string {
  if (/^(?:ROG|TUF|LC|WB|SFF|AMP|LP|SOC|BTF|ARGB|XLR8|GS|III|V1|V2|2X|3X|X3|MLG)$/.test(tok)) return tok;
  return tok.charAt(0) + tok.slice(1).toLowerCase();
}

function sigBase(s: Signature): string {
  return `${s.model}|${s.maker}|${s.vram}|${s.oc ? "OC" : ""}`;
}
function sigKey(s: Signature): string {
  return `${sigBase(s)}|${[...s.tokens].sort().join("+")}`;
}

// --- Build ------------------------------------------------------------------

interface ItemBuild extends CatalogItem {
  sig: Signature;
  /** Candidate display names, best-first after scoring. */
  names: string[];
  /** A part number cut short by the retailer's title limit, to resolve later. */
  mpnPrefix: string | null;
  /** True when `mpn` came from the retailer's part-number field (authoritative)
   *  rather than being parsed out of a title (possibly cut short). */
  mpnFromField: boolean;
}

/**
 * @param rawTitles Optional retailer titles keyed by `WatchView.watchId`.
 *   `WatchView.title` is the normalized canonical title, which drops the part
 *   number retailers print in the raw title; passing the raw titles lets the
 *   catalog recover it for cross-retailer matching.
 */
export function buildCatalog(
  products: ProductView[],
  rates: UsdRates,
  rawTitles?: ReadonlyMap<string, string>,
): CatalogProduct[] {
  const items = new Map<string, ItemBuild>();

  // 1. Catalog items: one per retailer product id, with their offers.
  for (const p of products) {
    const productModel = (p.mpn ?? "").replace(/\s+Desktop$/i, "").trim();
    for (const w of p.watches) {
      const rawTitle = (w.title ?? "").trim();
      if (!rawTitle && !w.mpn && !w.url) continue;
      const type = (w.category ?? "gpu") as CatalogType;
      const model = classifyGpuModel(rawTitle) ?? productModel ?? "";
      const ident = identify(w);
      const key = `${w.retailer}:${ident.id}`;
      const sku = stripRevision((w.mpn ?? "").trim());
      const retailerTitle = rawTitles?.get(w.watchId) ?? "";
      let mpn: string | null = null;
      let mpnSource: MpnSource | null = null;
      let mpnPrefix: string | null = null;
      let mpnFromField = false;
      const fieldMpn = RETAILER_OWN_SKU.has(w.retailer) ? null : retailerMpn(sku, w.retailer, type);
      if (fieldMpn) {
        mpn = fieldMpn;
        mpnSource = "retailer";
        mpnFromField = true;
      } else {
        const t = titleMpn(retailerTitle).mpn ? titleMpn(retailerTitle) : titleMpn(rawTitle);
        if (t.mpn && !t.truncated) {
          mpn = t.mpn;
          mpnSource = "title";
        } else if (t.mpn) mpnPrefix = t.mpn;
      }
      const condition = w.condition ?? "new";
      const price = w.price == null ? null : Number(w.price);
      const offer: CatalogOffer = {
        retailer: w.retailer,
        country: w.country,
        listingId: ident.listingId,
        url: w.url ?? "",
        condition,
        inStock: w.status === "in_stock",
        status: w.status,
        price,
        currency: w.currency,
        usd: toUsd(price, w.currency, rates),
        seller: w.seller,
        updatedAt: w.updatedAt,
      };
      const name = cleanName(rawTitle);

      let item = items.get(key);
      if (!item) {
        const maker = inferMaker(rawTitle, mpn, type, w.retailer);
        item = {
          key,
          retailer: w.retailer,
          id: ident.id,
          idKind: ident.kind,
          mpn,
          mpnSource,
          name: name || mpn || ident.id,
          maker,
          model,
          type,
          imageUrl: w.imageUrl ?? null,
          productKey: "",
          offers: [],
          inStock: 0,
          trackedProductId: p.id,
          trackedProductName: p.name,
          sig: signatureOf(rawTitle, mpn, model, maker),
          names: name ? [name] : [],
          mpnPrefix,
          mpnFromField,
        };
        items.set(key, item);
      } else {
        if (mpn && (!item.mpn || (mpnFromField && !item.mpnFromField))) {
          item.mpn = mpn;
          item.mpnSource = mpnSource;
          item.mpnFromField = item.mpnFromField || mpnFromField;
        }
        if (!item.mpnPrefix && mpnPrefix) item.mpnPrefix = mpnPrefix;
        if (!item.maker) item.maker = inferMaker(rawTitle, mpn, type, w.retailer);
        if (!item.imageUrl && w.imageUrl) item.imageUrl = w.imageUrl;
        if (name && !item.names.includes(name)) item.names.push(name);
        // Union the signature across the item's listings (titles differ per country).
        const s = signatureOf(rawTitle, mpn, model, item.maker);
        for (const t of s.tokens) item.sig.tokens.add(t);
        if (s.oc) item.sig.oc = true;
        if (!item.sig.vram && s.vram) item.sig.vram = s.vram;
      }
      // Dedupe offers on (country, listingId) — the same listing can be
      // reached from several tracked searches.
      if (!item.offers.some((o) => o.country === offer.country && o.listingId === offer.listingId && o.url === offer.url)) {
        item.offers.push(offer);
        if (offer.inStock) item.inStock++;
      }
    }
  }

  // Resolve part numbers truncated by a title limit against the full part
  // numbers other retailers reported, when the prefix is unambiguous.
  const fullMpns = new Map<string, string>();
  for (const it of items.values()) if (it.mpn && it.mpnFromField) fullMpns.set(compactMpn(it.mpn), it.mpn);
  for (const it of items.values()) {
    if (it.mpnFromField) continue;
    const candidate = it.mpn ?? it.mpnPrefix;
    if (!candidate) continue;
    const prefix = compactMpn(candidate);
    if (fullMpns.has(prefix)) continue; // already complete
    const hits = [...fullMpns.entries()].filter(([c]) => c.startsWith(prefix));
    const distinct = new Set(hits.map(([c]) => normMpn(c)));
    if (distinct.size === 1) {
      it.mpn = hits[0]![1];
      it.mpnSource = "title";
      const s = signatureOf("", it.mpn, it.model, it.maker);
      for (const t of s.tokens) it.sig.tokens.add(t);
      if (s.oc) it.sig.oc = true;
    } else if (!it.mpn && hits.length === 0 && prefix.length >= 14) {
      // Long enough to be a full part number nobody else reported.
      it.mpn = candidate;
      it.mpnSource = "title";
    }
  }

  for (const it of items.values()) {
    it.names.sort((a, b) => a.length - b.length);
    it.name = it.names[0] ?? it.name;
    // Non-GPU items (prebuilts, laptops, accessories) only group by MPN —
    // configurations differ too much for a title signature to be safe. The
    // same goes for systems the upstream classifier filed under "gpu".
    if (it.type !== "gpu" || it.names.some(looksLikeSystemTitle)) it.sig.tokens.add(`#${it.key}`);
  }

  // 2. Products. Pass A: group by manufacturer part number.
  const byMpn = new Map<string, ItemBuild[]>();
  const noMpn: ItemBuild[] = [];
  for (const it of items.values()) {
    if (it.mpn) {
      const k = normMpn(it.mpn);
      const list = byMpn.get(k);
      if (list) list.push(it);
      else byMpn.set(k, [it]);
    } else {
      noMpn.push(it);
    }
  }

  interface Group {
    key: string;
    members: ItemBuild[];
    sig: Signature;
  }
  const groups: Group[] = [];
  for (const [k, members] of byMpn) {
    const sig: Signature = { ...members[0]!.sig, tokens: new Set<string>() };
    for (const m of members) {
      for (const t of m.sig.tokens) if (!t.startsWith("#")) sig.tokens.add(t);
      if (m.sig.oc) sig.oc = true;
      if (!sig.vram && m.sig.vram) sig.vram = m.sig.vram;
    }
    groups.push({ key: `mpn:${k}`, members, sig });
  }

  // Pass B: attach MPN-less items to an MPN group with the same signature
  // (exact token set, or one missing modifier when the match is unambiguous);
  // otherwise group MPN-less items among themselves by exact signature.
  const bySigKey = new Map<string, Group[]>();
  const byBase = new Map<string, Group[]>();
  for (const g of groups) {
    if (g.members[0]!.type !== "gpu") continue;
    const sk = sigKey(g.sig);
    bySigKey.set(sk, [...(bySigKey.get(sk) ?? []), g]);
    const b = sigBase(g.sig);
    byBase.set(b, [...(byBase.get(b) ?? []), g]);
  }
  const sigGroups = new Map<string, Group>();
  for (const it of noMpn) {
    const sk = sigKey(it.sig);
    const exact = it.type === "gpu" ? bySigKey.get(sk) : undefined;
    if (exact && exact.length === 1) {
      exact[0]!.members.push(it);
      continue;
    }
    if (it.type === "gpu" && it.sig.tokens.size > 0) {
      const candidates = (byBase.get(sigBase(it.sig)) ?? []).filter((g) => {
        if (g.sig.tokens.size - it.sig.tokens.size !== 1) return false;
        for (const t of it.sig.tokens) if (!g.sig.tokens.has(t)) return false;
        return true;
      });
      if (candidates.length === 1) {
        candidates[0]!.members.push(it);
        continue;
      }
    }
    let g = sigGroups.get(sk);
    if (!g) {
      g = { key: `sig:${sk}`, members: [], sig: it.sig };
      sigGroups.set(sk, g);
      groups.push(g);
    }
    g.members.push(it);
  }

  // Pass C: tag every item with a part number.
  //   - Items matched into an MPN group by signature inherit the group's
  //     part number ("product").
  //   - Signature-only groups get one from the maker's naming scheme or the
  //     verified table ("pattern" / "catalog"). When that number is one
  //     another retailer already reported, the group is folded into that
  //     product — the generated number is the missing link.
  const groupByNorm = new Map<string, Group>();
  for (const g of groups) if (g.key.startsWith("mpn:")) groupByNorm.set(g.key.slice(4), g);
  for (const g of groups) {
    if (!g.key.startsWith("mpn:")) continue;
    const inherit = canonicalSpelling(g.members.map((m) => m.mpn));
    if (!inherit) continue;
    for (const m of g.members) {
      if (m.mpn) continue;
      m.mpn = inherit;
      m.mpnSource = "product";
    }
  }
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const g = groups[gi]!;
    if (!g.key.startsWith("sig:") || g.members[0]!.type !== "gpu") continue;
    if (g.members.some((m) => m.names.some(looksLikeSystemTitle))) continue;
    const found = lookupMpn({
      maker: g.sig.maker,
      model: g.sig.model,
      vram: g.sig.vram,
      oc: g.sig.oc,
      tokens: g.sig.tokens,
      titles: g.members.flatMap((m) => m.names),
    });
    if (!found) continue;
    for (const m of g.members) {
      m.mpn = found.mpn;
      m.mpnSource = found.source;
    }
    const target = groupByNorm.get(normMpn(found.mpn));
    if (target) {
      // Keep the retailer-reported spelling on items that join an existing product.
      const reported = canonicalSpelling(target.members.map((m) => m.mpn)) ?? found.mpn;
      for (const m of g.members) {
        m.mpn = reported;
        target.members.push(m);
      }
      for (const t of g.sig.tokens) target.sig.tokens.add(t);
      groups.splice(gi, 1);
    }
  }

  // Pass D: a renewed / open-box / used listing is the same retailer product
  // in another condition, not a catalog item of its own — even when the
  // retailer gives that stock its own id (PNY's "CR…" Newegg items beside the
  // "VCG…" ones, Amazon's refurbished ASINs). Fold such items into the same
  // retailer's item for the product; their listings stay visible as offers.
  for (const g of groups) {
    const byRetailer = new Map<string, ItemBuild[]>();
    for (const m of g.members) byRetailer.set(m.retailer, [...(byRetailer.get(m.retailer) ?? []), m]);
    for (const siblings of byRetailer.values()) {
      if (siblings.length < 2) continue;
      const isNewItem = (m: ItemBuild) => m.offers.some((o) => o.condition === "new");
      const secondary = siblings.filter((m) => !isNewItem(m));
      if (secondary.length === 0) continue;
      const rank = (m: ItemBuild) =>
        (isNewItem(m) ? 0 : 100) + (m.mpn && /^CR\d/i.test(m.mpn) ? 10 : 0) - Math.min(m.offers.length, 9);
      const primary = [...siblings].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0]!;
      for (const m of secondary) {
        if (m === primary) continue;
        for (const o of m.offers) {
          if (!primary.offers.some((p) => p.country === o.country && p.listingId === o.listingId && p.url === o.url)) {
            primary.offers.push(o);
          }
        }
        if (!primary.imageUrl && m.imageUrl) primary.imageUrl = m.imageUrl;
        for (const t of m.sig.tokens) if (!t.startsWith("#")) primary.sig.tokens.add(t);
        const spelling = canonicalSpelling([primary.mpn, m.mpn]);
        if (spelling && spelling !== primary.mpn) {
          primary.mpn = spelling;
          primary.mpnSource = m.mpnSource;
        }
        g.members.splice(g.members.indexOf(m), 1);
      }
      primary.inStock = primary.offers.filter((o) => o.inStock).length;
    }
  }

  // 3. Materialise products.
  const out: CatalogProduct[] = [];
  for (const g of groups) {
    const members = g.members;
    const maker = members.map((m) => m.maker).find(Boolean) ?? "";
    const model = members.map((m) => m.model).find(Boolean) ?? "";
    const type = members[0]!.type;
    const mpns = [...new Set(members.map((m) => m.mpn).filter((x): x is string => Boolean(x)))].sort();

    // Name: shortest candidate that still carries every variant token the
    // group knows about, preferring ones that name the maker.
    const groupTokens = [...g.sig.tokens].filter((t) => !t.startsWith("#") && t !== "BUNDLE");
    let bestName = "";
    let bestScore = Infinity;
    for (const m of members) {
      for (const n of m.names) {
        const up = n.toUpperCase();
        const missing = groupTokens.filter((t) => !up.includes(t) && !(t === "LC" && /\bLIQUID\b/.test(up)) && !(t === "XTREME" && /\bEXTREME\b/.test(up))).length;
        const hasMaker = !maker || up.includes(maker.toUpperCase());
        const hasOc = !g.sig.oc || /\bS?OC\b|\bOVERCLOCKED\b/.test(up);
        const messy = /\s[-–|]\s|[|(]/.test(n) ? 25 : 0;
        const score = missing * 40 + (hasMaker ? 0 : 30) + (hasOc ? 0 : 20) + messy + Math.min(n.length, 120);
        if (score < bestScore) {
          bestScore = score;
          bestName = n;
        }
      }
    }
    if (!bestName) bestName = mpns[0] ?? members[0]!.id;
    // Prefix the maker when the chosen title omits it (MSI's own store, Newegg's AORUS titles).
    if (maker && !bestName.toUpperCase().includes(maker.toUpperCase())) bestName = `${maker} ${bestName}`;
    // Append variant words the part number proves but no retailer title
    // carried (Newegg's "GIGABYTE AORUS RTX 5080" + GV-N5080AORUS M-16GD → "… Master").
    {
      const up = bestName.toUpperCase();
      const extra = groupTokens.filter(
        (t) => !up.includes(t) && !(t === "LC" && /\bLIQUID\b/.test(up)) && !(t === "XTREME" && /\bEXTREME\b/.test(up)),
      );
      if (extra.length > 0) bestName = `${bestName} ${extra.map(tokenLabel).join(" ")}`;
      if (g.sig.oc && !/\bS?OC\b|\bOVERCLOCKED\b/i.test(bestName)) bestName = `${bestName} OC`;
      if (type === "gpu" && g.sig.vram && !/\b\d{1,2}\s?G(?:B)?\b/i.test(bestName)) bestName = `${bestName} ${g.sig.vram}GB`;
      if (g.sig.tokens.has("BUNDLE") && !/\bbundle\b/i.test(bestName)) bestName = `${bestName} (Bundle)`;
    }

    const retailers = [...new Set(members.map((m) => m.retailer))].sort();
    const countries = [...new Set(members.flatMap((m) => m.offers.map((o) => o.country)))].sort();
    const conditions = [...new Set(members.flatMap((m) => m.offers.map((o) => o.condition)))];
    let offers = 0;
    let inStock = 0;
    let minUsd: number | null = null;
    let minUsdRetailer: string | null = null;
    let minUsdCountry: string | null = null;
    for (const m of members) {
      for (const o of m.offers) {
        offers++;
        if (!o.inStock) continue;
        inStock++;
        if (o.condition !== "new") continue;
        if (o.usd != null && (minUsd == null || o.usd < minUsd)) {
          minUsd = o.usd;
          minUsdRetailer = o.retailer;
          minUsdCountry = o.country;
        }
      }
    }
    // No new in-stock offer: fall back to the cheapest in-stock of any condition.
    if (minUsd == null) {
      for (const m of members) {
        for (const o of m.offers) {
          if (!o.inStock || o.usd == null) continue;
          if (minUsd == null || o.usd < minUsd) {
            minUsd = o.usd;
            minUsdRetailer = o.retailer;
            minUsdCountry = o.country;
          }
        }
      }
    }
    const imageUrl = members.map((m) => m.imageUrl).find(Boolean) ?? null;

    const key = `p:${g.key}`;
    const outItems: CatalogItem[] = members
      .map((m) => {
        const { sig: _sig, names: _names, ...rest } = m;
        rest.productKey = key;
        rest.offers = [...rest.offers].sort(
          (a, b) => Number(b.inStock) - Number(a.inStock) || (a.usd ?? Infinity) - (b.usd ?? Infinity),
        );
        return rest;
      })
      .sort((a, b) => a.retailer.localeCompare(b.retailer) || b.inStock - a.inStock || a.id.localeCompare(b.id));

    out.push({
      key,
      name: bestName,
      maker,
      model,
      type,
      mpns,
      items: outItems,
      retailers,
      countries,
      conditions,
      offers,
      inStock,
      minUsd,
      minUsdRetailer,
      minUsdCountry,
      imageUrl,
      trackedProductName: members[0]!.trackedProductName,
    });
  }

  out.sort(
    (a, b) =>
      a.model.localeCompare(b.model, undefined, { numeric: true }) ||
      a.type.localeCompare(b.type) ||
      a.maker.localeCompare(b.maker) ||
      a.name.localeCompare(b.name),
  );
  return out;
}
