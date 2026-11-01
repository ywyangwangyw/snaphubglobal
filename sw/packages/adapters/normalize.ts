/**
 * GPU product-title normalization — a faithful TypeScript port of
 * bfms/dealbots `title_normalizer.py`. Converts verbose retailer titles into
 * concise, industry-standard canonical names (the "universal truth" name a
 * product is known by, e.g. on VideoCardz.net).
 *
 *   {Brand} {Product-Line} RTX {Model} {Key-Variant} {VRAM}
 *
 *   "ASUS ROG Astral GeForce RTX 5090 32GB GDDR7 OC Edition ROG-ASTRAL-RTX5090-O32G-GAMING
 *    DLSS 4.0 PCI Express 5.0 Graphics Card"
 *     -> "ASUS ROG Astral RTX 5090 OC 32GB"
 */

// --- Variant qualifiers -----------------------------------------------------
const OC_WORDS = /\bO(?:C\s+Edition|verclocked\s+Edition|verclocked)\b/gi;

// --- Noise phrases to strip (order matters) ---------------------------------
const STRIP_PATTERNS: RegExp[] = [
  /\s*\+\s*\d+\s+\w+.*$/g,
  /,\s*\d+\s+Year\s+Warranty\b.*$/gi,
  /,?\s*\d{3,4}W\b.*$/gi,
  /\s*\([^)]*(?:PCIe|HDMI|Display|Slot|Fan|Chamber|Warranty)[^)]*\)/gi,
  /,\s*(?:by\s+\w+|PCI|PCIe|WIND|\d+GB|\d+[- ]?[Bb]it|Display|HDMI|Versatile).*$/gi,
  /\s*-\s*(?:Video\s+Output\s+Interface|Video\s+Card[o]?|Gaming\s+Graphics\s+Card).*$/gi,
  /\bby\s+(?:NVIDIA|AMD|Intel)\b/gi,
  /\bPCI(?:-?\s*Express|e)\s*\d+\.\d+(?:\s*x\s*\d+)?\b/gi,
  /\bGDDR\d+[Xx]?\b/g,
  /\b\d{3}[- ]?[Bb]it\b/g,
  /\bDLSS\s*\d+\.?\d*\b/gi,
  /\bGaming\s+Graphics\s+Card\b/gi,
  /\bGraphics\s+Card\b/gi,
  /\bVideo\s+Cardo?\b/gi,
  /\b(?:Triple|Quad|Dual|Single|Twin)\s+(?:Fan|Fans)\b/gi,
  /\b\d+[xX-]\s*Fan\s*(?:Design)?\b/gi,
  /\bFan\s+Design\b/gi,
  /\bAxial\s+Fans?\b/gi,
  /\bWINDFORCE\s+Cooling\s+System\b/gi,
  /\bVersatile\s+VGA\s+Holder\b/gi,
  /\bLiquid\s+Cooled\b/gi,
  /\bVapor\s+Chamber\b/gi,
  /\bPatented\b/gi,
  /\b\d+(?:\.\d+)?[- ]Slot\b/gi,
  /\bATX\b/g,
  /\b(?:DisplayPort|HDMI)\b.*$/gi,
  /\bVideo\s+Output\s+Interface\b/gi,
  /\bEdition\b/gi,
  /\bx16\b/gi,
];

// All-uppercase+digits dash-segmented SKU codes, e.g. ROG-ASTRAL-RTX5090-O32G-GAMING
const SKU_RE = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g;

// Product-line tokens protected from the SKU stripper.
const PROTECTED_TOKENS: [string, RegExp][] = [
  ["__EPICX__", /\bEPIC-X\b/gi],
  ["__XLR8__", /\bXLR8\b/gi],
];

// Manufacturer part number (may contain spaces between segments).
const MPN_RE = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+(?:\s+[A-Z0-9]+(?:-[A-Z0-9]+)+)*\b/g;
const MPN_RE_FULL = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+(?:\s+[A-Z0-9]+(?:-[A-Z0-9]+)+)*$/;

const MPN_DENY = new Set([
  "PCI-E", "PCI-EXPRESS", "G-SYNC", "E-ATX", "V-COLOR", "TRI-FROZR",
  "WI-FI", "TORX-FAN", "TUF-GAMING", "TRI-FAN", "TWO-FAN", "TRIPLE-FAN",
  "TYPE-C", "USB-C", "DUAL-BIOS", "TRI-MODE", "HDMI-DP", "DP-HDMI",
]);

const RTX_MODEL_RE = /\bRTX\s*(\d{4})\b/g;

// Maps product-line words to their AIB brand — ordered, specific first.
const LINE_TO_BRAND_PRIORITY: [string, string][] = [
  ["ROG", "ASUS"], ["TUF", "ASUS"], ["PRIME", "ASUS"],
  ["AORUS", "GIGABYTE"], ["WINDFORCE", "GIGABYTE"],
  ["SUPRIM", "MSI"], ["VENTUS", "MSI"], ["MECH", "MSI"],
  ["ARCTICSTORM", "ZOTAC"], ["TRINITY", "ZOTAC"], ["SOLID", "ZOTAC"],
  ["XLR8", "PNY"], ["ARGB", "PNY"],
  ["GAMING", "GIGABYTE"],
];

const KNOWN_BRANDS = new Set([
  "ASUS", "GIGABYTE", "MSI", "ZOTAC", "PNY", "EVGA", "PALIT",
  "INNO3D", "GAINWARD", "COLORFUL", "NVIDIA",
]);

const BRAND_CANONICAL: Record<string, string> = {
  GIGABYTE: "GIGABYTE", ASUS: "ASUS", MSI: "MSI",
  NVIDIA: "NVIDIA", ZOTAC: "ZOTAC", PNY: "PNY",
  EVGA: "EVGA", PALIT: "Palit", INNO3D: "Inno3D",
  GAINWARD: "Gainward", COLORFUL: "Colorful",
};

const AIB_BRANDS = new Set([...KNOWN_BRANDS].filter((b) => b !== "NVIDIA"));

// --- Helpers ----------------------------------------------------------------

function wordBoundary(keyword: string): RegExp {
  return new RegExp(`\\b${keyword}\\b`);
}

/** True when a string has the shape of a manufacturer part number. */
export function looksLikeMpn(value: string): boolean {
  const candidate = value.replace(/\s+/g, " ").trim();
  if (candidate.length < 8 || MPN_DENY.has(candidate.toUpperCase())) return false;
  if (!/\d/.test(candidate)) return false;
  if (/^\d+$/.test(candidate)) return false; // UPC / EAN
  return MPN_RE_FULL.test(candidate);
}

/** Return the manufacturer part number printed in a GPU title, or "". */
export function extractGpuMpn(title: string): string {
  let best = "";
  for (const m of title.matchAll(MPN_RE)) {
    const candidate = m[0].replace(/\s+/g, " ").trim();
    if (looksLikeMpn(candidate) && candidate.length > best.length) best = candidate;
  }
  return best;
}

/** Infer the AIB brand from product-line keywords in the title, or "". */
function inferBrand(title: string): string {
  const t = title.toUpperCase();
  for (const [keyword, brand] of LINE_TO_BRAND_PRIORITY) {
    if (wordBoundary(keyword).test(t)) return brand;
  }
  return "";
}

/** Canonical capitalisation for a known brand name. */
function canonicalBrand(brand: string): string {
  const first = brand.trim().split(/\s+/)[0] ?? "";
  return BRAND_CANONICAL[first.toUpperCase()] ?? first;
}

/** Return the AIB brand already named in the title, or "". */
function brandNamedInTitle(title: string): string {
  const upper = title.toUpperCase();
  for (const brand of AIB_BRANDS) {
    if (wordBoundary(brand).test(upper)) return brand;
  }
  return "";
}

/**
 * The maker (AIB brand) of a GPU product, from its raw or canonical title:
 * a brand named outright ("MSI …", "GIGABYTE …"), else inferred from a
 * product-line word ("ROG" → ASUS, "VENTUS" → MSI), else "NVIDIA" for a
 * Founders Edition, else "". Canonical capitalisation ("Palit", "Inno3D").
 */
export function inferGpuBrand(title: string | null | undefined): string {
  if (!title) return "";
  const named = brandNamedInTitle(title);
  if (named) return canonicalBrand(named);
  const inferred = inferBrand(title);
  if (inferred) return canonicalBrand(inferred);
  if (/\b(?:Founders\s+Edition|\bFE\b)/i.test(title) || /^\s*NVIDIA\b/i.test(title)) return "NVIDIA";
  return "";
}

// --- Main normalizer ---------------------------------------------------------

/** Return a concise, industry-standard short name for a GPU product title. */
export function normalizeGpuTitle(title: string, brand = ""): string {
  let s = title.trim();

  // 1. "Founders Edition" -> "FE"
  s = s.replace(/\bFounders\s+Edition\b/gi, "FE");
  // 2. Strip "NVIDIA " prefix that precedes "GeForce" (not the AIB brand).
  s = s.replace(/\bNVIDIA\s+(?=GeForce\b)/gi, "");
  // 3. "GeForce RTX" -> "RTX"
  s = s.replace(/\bGeForce\s+RTX[™®]?\s*/gi, "RTX ");
  // 4. "OC Edition" / "Overclocked Edition" / "Overclocked" -> "OC"
  s = s.replace(OC_WORDS, "OC");
  // 5. Apply all noise-strip patterns in order.
  for (const pattern of STRIP_PATTERNS) s = s.replace(pattern, "");
  // 6. Remove SKU codes, protecting known product-line tokens first.
  for (const [placeholder, ptn] of PROTECTED_TOKENS) s = s.replace(ptn, placeholder);
  s = s.replace(SKU_RE, "");
  for (const [placeholder] of PROTECTED_TOKENS) {
    const original = placeholder.replace(/_/g, "").replace("EPICX", "EPIC-X");
    s = s.split(placeholder).join(original);
  }
  // 7. "32G" -> "32GB" (MSI shorthand)
  s = s.replace(/\b(\d+)G\b(?!B)/g, "$1GB");
  // 8. Deduplicate repeated "RTX XXXX" — keep first occurrence only.
  const modelMatches = [...s.matchAll(RTX_MODEL_RE)];
  if (modelMatches.length > 1) {
    for (const m of modelMatches.slice(1).reverse()) {
      const start = (m.index ?? 0);
      s = s.slice(0, start).replace(/\s+$/, "") + " " + s.slice(start + m[0].length);
    }
  }
  // 9. Deduplicate repeated 2-word bigrams (case-insensitive).
  const words = s.split(/\s+/);
  const seenBigrams = new Set<string>();
  const kept: string[] = [];
  let skipNext = false;
  for (let idx = 0; idx < words.length; idx++) {
    if (skipNext) { skipNext = false; continue; }
    const current = words[idx] ?? "";
    if (idx + 1 < words.length) {
      const next = words[idx + 1] ?? "";
      const bigram = `${current.toUpperCase()} ${next.toUpperCase()}`;
      if (seenBigrams.has(bigram)) { skipNext = true; continue; }
      seenBigrams.add(bigram);
    }
    kept.push(current);
  }
  s = kept.join(" ");
  // 10. Collapse whitespace + strip artifacts.
  s = s.replace(/[™®©]/g, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  s = s.replace(/\s+([,./])/g, "$1");
  s = s.replace(/^[ ,.\-/]+|[ ,.\-/]+$/g, "");
  // 11. Prepend brand if not already present.
  const rawBrand = brand.trim();
  const shortBrand = rawBrand ? canonicalBrand(rawBrand) : inferBrand(s);
  if (shortBrand) {
    const brandWord = (shortBrand.split(/\s+/)[0] ?? "").toUpperCase();
    const named = brandNamedInTitle(s);
    if (!s.toUpperCase().split(/\s+/).includes(brandWord) && !(named && named !== brandWord)) {
      s = `${shortBrand} ${s}`;
    }
  }
  return s.trim();
}
