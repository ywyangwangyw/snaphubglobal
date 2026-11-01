/**
 * Industry part numbers for RTX 50-series cards, for catalog items whose
 * retailer never exposed one (Amazon ASINs, Best Buy SKUs, MSI's own store).
 *
 * Two kinds of knowledge:
 *   - Makers with a deterministic naming scheme (ASUS, GIGABYTE, PNY, MSI)
 *     get a generator that composes the part number from the variant
 *     signature — product line + VRAM + OC + colour/cooling modifiers. The
 *     schemes were checked against the part numbers retailers DO report
 *     (Newegg's "Model" field) and the makers' own product pages.
 *   - Makers whose numbers are arbitrary (ZOTAC, NVIDIA FE, Inno3D) get a
 *     curated table; every entry was verified on the maker's site, a spec
 *     sheet, or a retailer listing that prints the part number.
 *
 * Generators return null rather than guess when the signature is ambiguous.
 */

/** Where a catalog item's part number came from. */
export type MpnSource =
  /** The retailer's part-number / model field. */
  | "retailer"
  /** Printed in the retailer's listing title. */
  | "title"
  /** Inherited from a sibling catalog item of the same product. */
  | "product"
  /** Composed from the maker's documented naming scheme. */
  | "pattern"
  /** Looked up in the verified part-number table below. */
  | "catalog";

export interface MpnLookupInput {
  maker: string;
  /** "RTX 5090" … */
  model: string;
  /** "32", "16", … or "" when unknown. */
  vram: string;
  oc: boolean;
  /** Variant tokens from the title/MPN signature (uppercase). */
  tokens: ReadonlySet<string>;
  /** Cleaned listing titles, for details the signature drops (fan count, RGB). */
  titles: readonly string[];
}

export interface MpnLookup {
  mpn: string;
  source: MpnSource;
}

const MODEL_CODE_ASUS: Record<string, string> = {
  "RTX 5090": "RTX5090",
  "RTX 5080": "RTX5080",
  "RTX 5070 Ti": "RTX5070TI",
  "RTX 5070": "RTX5070",
  "RTX 5060 Ti": "RTX5060TI",
  "RTX 5060": "RTX5060",
};
const MODEL_CODE_GIGABYTE: Record<string, string> = {
  "RTX 5090": "5090",
  "RTX 5080": "5080",
  "RTX 5070 Ti": "507T",
  "RTX 5070": "5070",
  "RTX 5060 Ti": "506T",
  "RTX 5060": "5060",
};
const MODEL_CODE_PNY: Record<string, string> = {
  "RTX 5090": "5090",
  "RTX 5080": "5080",
  "RTX 5070 Ti": "5070T",
  "RTX 5070": "5070",
  "RTX 5060 Ti": "5060T",
  "RTX 5060": "5060",
};

/**
 * ASUS: {LINE}-{MODEL}-{O?}{VRAM}G[-BTF][-WHITE][-EVO][-GAMING]
 *   ROG-ASTRAL-RTX5090-O32G-GAMING · ROG-ASTRAL-RTX5080-O16G-WHITE ·
 *   TUF-RTX5070TI-O16G-WHITE-GAMING · TUF-RTX5080-O16G-BTF-GAMING ·
 *   PRIME-RTX5080-O16G-EVO · PRIME-RTX5070-O12G-WHITE · PROART-RTX5080-O16G ·
 *   DUAL-RTX5060TI-O16G · RTX5080-O16G-NOCTUA · RTX5060-O8G-LP-BRK
 */
function asus(i: MpnLookupInput): string | null {
  const code = MODEL_CODE_ASUS[i.model];
  if (!code || !i.vram) return null;
  const t = i.tokens;
  const mem = `${i.oc ? "O" : ""}${i.vram}G`;
  const white = t.has("WHITE");
  if (t.has("NOCTUA")) return `${code}-${mem}-NOCTUA`;
  if (t.has("LP")) return `${code}-${mem}-LP-BRK`;
  let line: string;
  let gaming = false;
  if (t.has("ASTRAL")) {
    line = t.has("LC") ? "ROG-ASTRAL-LC" : "ROG-ASTRAL";
    gaming = !white; // ASUS drops the GAMING suffix on white Astrals
  } else if (t.has("STRIX")) {
    line = "ROG-STRIX";
    gaming = true;
  } else if (t.has("MATRIX")) {
    line = "ROG-MATRIX";
    gaming = true;
  } else if (t.has("TUF")) {
    line = "TUF";
    gaming = true;
  } else if (t.has("PROART")) line = "PROART";
  else if (t.has("PRIME")) line = "PRIME";
  else if (t.has("DUAL")) line = "DUAL";
  else return null;
  const parts = [line, code, mem];
  if (t.has("BTF")) parts.push("BTF");
  if (white) parts.push("WHITE");
  if (t.has("EVO")) parts.push("EVO");
  if (gaming) parts.push("GAMING");
  return parts.join("-");
}

/**
 * GIGABYTE: GV-N{CODE}{LINE}[ OC][V2]-{VRAM}GD   (low profile: GV-N5060OC-8GL)
 *   GV-N5090AORUS M-32GD · GV-N5080AORUSM ICE-16GD · GV-N5090AORUSX W-32GD ·
 *   GV-N5090AORUSX WB-32GD · GV-N5090AORUS IF-32GD · GV-N5080GAMING OC-16GD ·
 *   GV-N5060GAMING OCV2-8GD · GV-N507TWF3OC-16GD · GV-N507TWF3OCV2-16GD ·
 *   GV-N506TWF2MAX OC-8GD · GV-N5060EAGLEMAX OC-8GD · GV-N507TEAGLEOC ICE-16GD ·
 *   GV-N5080AERO OC-16GD
 */
function gigabyte(i: MpnLookupInput): string | null {
  const code = MODEL_CODE_GIGABYTE[i.model];
  if (!code || !i.vram) return null;
  const t = i.tokens;
  const oc = i.oc;
  const v2 = t.has("V2") ? "V2" : "";
  if (t.has("LP")) return oc ? `GV-N${code}OC-${i.vram}GL` : null;
  let line: string | null = null;
  if (t.has("AORUS")) {
    if (t.has("XTREME") && t.has("WATERFORCE")) line = t.has("WB") ? "AORUSX WB" : "AORUSX W";
    else if (t.has("MASTER")) line = t.has("ICE") ? "AORUSM ICE" : "AORUS M";
    else if (t.has("INFINITY")) line = t.has("WOOD") ? null : "AORUS IF";
    else return null;
  } else if (t.has("EAGLE")) {
    if (t.has("MAX")) line = oc ? `EAGLEMAX OC${v2}` : "EAGLEMAX";
    else if (t.has("ICE")) line = oc ? "EAGLEOC ICE" : null;
    else line = oc ? `EAGLE OC${v2}` : "EAGLE";
  } else if (t.has("AERO")) {
    line = oc ? `AERO OC${v2}` : "AERO";
  } else if (t.has("GAMING")) {
    line = oc ? `GAMING OC${v2}` : "GAMING";
  } else if (t.has("WINDFORCE")) {
    const fans = i.model === "RTX 5060 Ti" || i.model === "RTX 5060" ? "WF2" : "WF3";
    if (t.has("MAX")) line = oc ? `${fans}MAX OC${v2}` : `${fans}MAX`;
    else line = `${fans}${oc ? "OC" : ""}${v2}`;
  }
  if (!line) return null;
  return `GV-N${code}${line}-${i.vram}GD`;
}

/**
 * PNY: VCG{CODE}{VRAM}{TF|DF}{S}X{X}PB1[-O]
 *   VCG509032TFXXPB1-O (EPIC-X ARGB OC, triple fan) · VCG508016TFXPB1 (triple
 *   fan) · VCG5060T8TFXXPB1-O · VCG50608DFXPB1 (dual fan) · VCG50608DFXPB1-O ·
 *   VCG508016DFSXPB1-O (Slim dual fan OC)
 * TF/DF = triple/dual fan; S = Slim; the second X marks EPIC-X ARGB lighting;
 * -O = OC.
 */
function pny(i: MpnLookupInput): string | null {
  const code = MODEL_CODE_PNY[i.model];
  if (!code || !i.vram) return null;
  const text = i.titles.join(" ");
  const rgb = i.tokens.has("EPIC-X") || i.tokens.has("ARGB") || /\bEPIC-?X\b|\bA?RGB\b/i.test(text);
  const slim = i.tokens.has("SLIM");
  let fans: "TF" | "DF" | null = slim ? "DF" : /\btriple[-\s]?fan\b/i.test(text) ? "TF" : /\bdual[-\s]?fan\b/i.test(text) ? "DF" : null;
  if (!fans) {
    // PNY's 5060-class cards are dual fan; everything above is triple fan,
    // as are all EPIC-X ARGB cards.
    fans = rgb || !(i.model === "RTX 5060" || i.model === "RTX 5060 Ti") ? "TF" : "DF";
  }
  return `VCG${code}${i.vram}${fans}${slim ? "S" : ""}X${rgb ? "X" : ""}PB1${i.oc ? "-O" : ""}`;
}

/**
 * MSI's model name IS the identifier retailers list as the part number:
 *   RTX 5080 16G GAMING TRIO OC WHITE · RTX 5090 32G SUPRIM LIQUID SOC ·
 *   RTX 5060 Ti 16G VENTUS 2X OC BLACK PLUS · RTX 5070 Ti 16G VENTUS 3X PZ OC ·
 *   RTX 5070 Ti 16G FRIEREN EDITION OC · RTX 5090 32G VANGUARD SOC LAUNCH EDITION
 */
const MSI_ORDER = [
  "SUPRIM", "VANGUARD", "LIGHTNING", "EXPERT", "GAMING", "VENTUS", "SHADOW", "INSPIRE", "FRIEREN", "MLG",
  "LIQUID", "TRIO", "3X", "2X", "PZ",
] as const;
const MSI_LINES = new Set(["SUPRIM", "VANGUARD", "LIGHTNING", "EXPERT", "GAMING", "VENTUS", "SHADOW", "INSPIRE", "FRIEREN", "MLG"]);
function msi(i: MpnLookupInput): string | null {
  if (!i.vram) return null;
  const t = new Set(i.tokens);
  if (t.has("LC")) t.add("LIQUID");
  if (![...t].some((x) => MSI_LINES.has(x))) return null;
  const words: string[] = [];
  for (const w of MSI_ORDER) if (t.has(w)) words.push(w);
  // Collaboration editions: "SUPRIM DRACO EPIC EDITION" (no OC word),
  // "FRIEREN EDITION OC", "MLG EDITION OC".
  if (t.has("DRACO")) return `${i.model} ${i.vram}G ${words.join(" ")} DRACO EPIC EDITION`;
  if (t.has("FRIEREN") || t.has("MLG")) words.push("EDITION");
  if (t.has("SOC")) words.push("SOC");
  else if (i.oc) words.push("OC");
  if (t.has("WHITE")) words.push("WHITE");
  if (t.has("BLACK")) words.push("BLACK");
  if (t.has("PLUS")) words.push("PLUS");
  if (t.has("LAUNCH")) words.push("LAUNCH", "EDITION");
  return `${i.model} ${i.vram}G ${words.join(" ")}`;
}

/** Canonical form for an MSI model name reported by a retailer
 *  ("RTX 5070 TI 16G VENTUS 3X OC" → "RTX 5070 Ti 16G VENTUS 3X OC"). */
export function canonicalMsiModelName(value: string): string | null {
  const m = value.trim().toUpperCase().replace(/\s+/g, " ").match(/^(?:GEFORCE )?RTX (\d{4})( TI)? (\d{1,2})G ([A-Z0-9 ]+)$/);
  if (!m) return null;
  return `RTX ${m[1]}${m[2] ? " Ti" : ""} ${m[3]}G ${m[4]!.trim()}`;
}

/** Verified ZOTAC SKUs: [model, vram, variant tokens, oc, sku]. */
const ZOTAC: Array<[string, string, string[], boolean, string]> = [
  ["RTX 5090", "32", ["AMP", "XTREME", "INFINITY"], false, "ZT-B50900B-10A"],
  ["RTX 5090", "32", ["SOLID"], true, "ZT-B50900J-10A"],
  ["RTX 5090", "32", ["SOLID", "WHITE"], true, "ZT-B50900Q-10A"],
  ["RTX 5080", "16", ["SOLID", "CORE"], true, "ZT-B50800J2-10A"],
  ["RTX 5080", "16", ["SOLID", "CORE"], false, "ZT-B50800D2-10P"],
  ["RTX 5080", "16", ["SOLID", "WHITE"], true, "ZT-B50800Q-10P"],
  ["RTX 5070 Ti", "16", ["AMP", "XTREME", "INFINITY"], false, "ZT-B50710B-10P"],
  ["RTX 5070 Ti", "16", ["APOCALYPSE"], true, "ZT-B50710C-10P"],
  ["RTX 5070 Ti", "16", ["SOLID", "SFF"], true, "ZT-B50710J3-10P"],
  ["RTX 5070 Ti", "16", ["SOLID", "CORE", "WHITE"], true, "ZT-B50710Q2-10P"],
  ["RTX 5070", "12", ["SOLID"], false, "ZT-B50700D-10P"],
  ["RTX 5070", "12", ["SOLID"], true, "ZT-B50700J-10A"],
  ["RTX 5070", "12", ["AMP", "WHITE"], false, "ZT-B50700FQ-10A"],
  ["RTX 5070", "12", ["TWIN", "EDGE"], true, "ZT-B50700H-10P"],
  ["RTX 5070", "12", ["TWIN", "EDGE", "WHITE"], true, "ZT-B50700Q-10P"],
  ["RTX 5060 Ti", "16", ["TWIN", "EDGE"], true, "ZT-B50620H-10M"],
  ["RTX 5060 Ti", "16", ["TWIN", "EDGE", "WHITE"], true, "ZT-B50620Q-10M"],
  ["RTX 5060 Ti", "16", ["AMP"], false, "ZT-B50620F-10M"],
  ["RTX 5060 Ti", "8", ["TWIN", "EDGE"], true, "ZT-B50610H-10M"],
  ["RTX 5060 Ti", "8", ["TWIN", "EDGE", "WHITE"], true, "ZT-B50610Q-10M"],
  ["RTX 5060 Ti", "8", ["AMP"], false, "ZT-B50610F-10M"],
  ["RTX 5060", "8", ["AMP"], false, "ZT-B50600F-10M"],
  ["RTX 5060", "8", ["SOLO"], false, "ZT-B50600G-10L"],
  ["RTX 5060", "8", ["TWIN", "EDGE"], true, "ZT-B50600H-10M"],
  ["RTX 5060", "8", ["TWIN", "EDGE", "WHITE"], true, "ZT-B50600Q-10M"],
  ["RTX 5060", "8", ["LP"], false, "ZT-B50600L-10A"],
];
const ZOTAC_VARIANT_TOKENS = new Set([
  "AMP", "XTREME", "INFINITY", "SOLID", "CORE", "WHITE", "TWIN", "EDGE", "SOLO", "LP", "SFF", "ARCTICSTORM", "APOCALYPSE",
]);
function zotac(i: MpnLookupInput): string | null {
  if (!i.vram) return null;
  const variant = [...i.tokens].filter((t) => ZOTAC_VARIANT_TOKENS.has(t)).sort().join("+");
  // AMP cards are factory-OC by definition; titles rarely say "OC", so the
  // table keys them as non-OC and we ignore the flag for them.
  const ampLike = i.tokens.has("AMP");
  for (const [model, vram, tokens, oc, mpn] of ZOTAC) {
    if (model !== i.model || vram !== i.vram) continue;
    if ([...tokens].sort().join("+") !== variant) continue;
    if (!ampLike && oc !== i.oc) continue;
    return mpn;
  }
  return null;
}

/** NVIDIA Founders Edition. */
const NVIDIA_FE: Record<string, string> = {
  "RTX 5090": "900-1G144-2530-000",
  "RTX 5080": "900-1G144-2545-000",
  "RTX 5070": "900-1G146-2570-000",
};
function nvidia(i: MpnLookupInput): string | null {
  // Only the bare Founders card — any AIB line word means it's not one.
  for (const t of i.tokens) if (t !== "FOUNDERS") return null;
  return NVIDIA_FE[i.model] ?? null;
}

/** Inno3D (inno3d.com product comparison / spec sheets). */
function inno3d(i: MpnLookupInput): string | null {
  if (i.model !== "RTX 5090") return null;
  const t = i.tokens;
  if (t.has("FROSTBITE")) return "C50903-32D7X-1759FB";
  if (t.has("ICHILL") && t.has("X3")) return "C50903-32D7X-175967H";
  if (t.has("X3")) return i.oc ? "N50903-32D7X-17593928" : "N50903-32D7-17593928";
  return null;
}

/** Best-known manufacturer part number for a GPU variant, or null. */
export function lookupMpn(i: MpnLookupInput): MpnLookup | null {
  if (i.tokens.has("BUNDLE")) return null;
  const pattern = (m: string | null): MpnLookup | null => (m ? { mpn: m, source: "pattern" } : null);
  const table = (m: string | null): MpnLookup | null => (m ? { mpn: m, source: "catalog" } : null);
  switch (i.maker.toUpperCase()) {
    case "ASUS": return pattern(asus(i));
    case "GIGABYTE": return pattern(gigabyte(i));
    case "PNY": return pattern(pny(i));
    case "MSI": return pattern(msi(i));
    case "ZOTAC": return table(zotac(i));
    case "NVIDIA": return table(nvidia(i));
    case "INNO3D": return table(inno3d(i));
    default: return null;
  }
}
