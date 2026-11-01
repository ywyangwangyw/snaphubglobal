/**
 * Canonical GPU model catalog + title → model classification.
 *
 * This is the "basic catalog source" the poller uses to route each retailer
 * listing to the correct product — so a "RTX 5060 Ti" listing never lands on
 * the "RTX 5060" product card (and vice versa), which happened when we trusted
 * the retailer search query alone (Newegg's "rtx 5060 ti" search also returns
 * base 5060 cards, since "5060" is a substring of "5060 ti").
 *
 * Each model carries a word-boundary regex. Order is critical: the **Ti**
 * variant is listed BEFORE its base model so the classifier matches the more
 * specific "RTX 5060 Ti" before the looser "RTX 5060" (which would also match
 * the substring "5060" inside "5060 Ti").
 */

export interface GpuModel {
  /** Canonical manufacturer part number, e.g. "RTX 5060 Ti". Matches `products.mpn`. */
  mpn: string;
  /** Canonical product name, e.g. "NVIDIA GeForce RTX 5060 Ti". Matches `products.name`. */
  name: string;
  /** Title-matching pattern. Word boundaries prevent "5060" matching "50605". */
  pattern: RegExp;
}

/**
 * The RTX 50-series lineup we track. Ti/Super variants MUST precede their base
 * model so the longer match wins. Append new generations here as needed.
 */
export const GPU_CATALOG: readonly GpuModel[] = [
  { mpn: "RTX 5060 Ti", name: "NVIDIA GeForce RTX 5060 Ti", pattern: /\bRTX\s*5060\s*Ti\b/i },
  { mpn: "RTX 5060", name: "NVIDIA GeForce RTX 5060", pattern: /\bRTX\s*5060\b/i },
  { mpn: "RTX 5070 Ti", name: "NVIDIA GeForce RTX 5070 Ti", pattern: /\bRTX\s*5070\s*Ti\b/i },
  { mpn: "RTX 5070", name: "NVIDIA GeForce RTX 5070", pattern: /\bRTX\s*5070\b/i },
  { mpn: "RTX 5080", name: "NVIDIA GeForce RTX 5080", pattern: /\bRTX\s*5080\b/i },
  { mpn: "RTX 5090", name: "NVIDIA GeForce RTX 5090", pattern: /\bRTX\s*5090\b/i },
];

/** Map of mpn → GpuModel for O(1) lookups when building the poller's catalog index. */
export const GPU_BY_MPN: ReadonlyMap<string, GpuModel> = new Map(
  GPU_CATALOG.map((m) => [m.mpn, m]),
);

/**
 * Classify a listing by its actual GPU model, parsed from the title.
 * Returns the canonical mpn (e.g. "RTX 5060 Ti") or null when no known model
 * is found — in which case the poller SKIPS the listing rather than guessing
 * (guessing is what caused the 5060/5060-Ti mix-up).
 *
 * Prefers `canonicalTitle` (already normalized) over the raw retailer `title`.
 */
export function classifyGpuModel(title: string | null | undefined): string | null {
  if (!title) return null;
  for (const model of GPU_CATALOG) {
    if (model.pattern.test(title)) return model.mpn;
  }
  return null;
}

/** Product category for a listing. "gpu" = the desktop graphics card; "laptop"
 *  = a laptop/notebook that CONTAINS the GPU (or a laptop-class "Laptop GPU"
 *  variant) — kept separate so it never pollutes the desktop-card view;
 *  "desktop" = a prebuilt PC / gaming tower that CONTAINS the GPU (a whole
 *  system, not just the card) — kept separate from discrete GPU cards;
 *  "accessory" = a GPU-related part that ISN'T the card (water block, cooler,
 *  backplate, bracket, riser cable, PSU, etc.); "other" = irrelevant junk to drop. */
export type ListingCategory = "gpu" | "desktop" | "accessory" | "laptop" | "other";

export const RENEWED_OR_REFURBISHED_RE =
  /\b(renewed|refurbished|recertified|reconditioned|pre-owned|open\s*box|open-box|\brec\b)\b/i;

/**
 * Laptop keywords. A listing whose title contains one of these is a LAPTOP
 * (a whole notebook, or a laptop-class "Laptop GPU" variant), not a desktop
 * graphics card — e.g. "ASUS ROG Strix SCAR 18 RTX 5090 Laptop", "RTX 5090
 * Laptop GPU", or external mobile eGPUs like "ROG XG Mobile". Matched
 * case-insensitively with word boundaries. This is checked BEFORE the
 * GDDR/"Graphics Card" guard because a laptop listing can still mention "GDDR7"
 * (the GPU inside has VRAM) but is NOT a desktop card.
 */
const LAPTOP_RE =
  /\b(laptop|notebook|gaming\s*laptop|xg\s*mobile|egpu|external\s*graphics(?:\s*card|\s*dock)?)\b/i;

/**
 * Desktop-PC keywords. A listing whose title contains one of these is a
 * PREBUILT DESKTOP (a whole gaming PC / tower that contains the GPU), not a
 * discrete graphics card — e.g. "Skytech Gaming PC, Ryzen 9 9950X3D, GeForce
 * RTX 5090" or "MSI Infinite ZS Gaming Desktop". Matched case-insensitively
 * with word boundaries. Checked BEFORE the GDDR/"Graphics Card" guard because
 * a desktop listing mentions "GeForce RTX 5090 32GB GDDR7" (the card inside
 * it) yet is a whole PC, not a discrete card.
 */
const DESKTOP_RE =
  /\b(gaming\s+desktop|gaming\s+pc|desktop\s+pc|gaming\s+computer|gaming\s+tower|pre-?built|omen\s+(?:max\s+)?\d+l|alienware\s+area-51\s+a\w+|infinite\s+zs|vengeance\s+[ai]\d{4})\b/i;

/** CPU-model keywords — only appear in prebuilt-PC titles, never in discrete
 *  GPU card titles. Used as a secondary desktop signal: a listing that
 * carries a CPU model (Ryzen, Core i7, Core Ultra, Threadripper) alongside
 * a GPU model is a whole desktop, not a card. */
const CPU_RE = /\b(ryzen|core\s+(?:i\d|ultra|\d{2,5})|threadripper|epyc|\d{4,5}[kxf]{1,3})\b/i;

const CASE_RE =
  /\b(pc\s*case|computer\s*case|atx\s*(?:mid|full)?\s*tower|mid-?tower|full-?tower|chassis)\b/i;

/**
 * Accessory keywords. A listing whose title matches one of these is a GPU
 * *accessory* (a part FOR a card), not the card itself — e.g. "Water Block for
 * MSI GeForce RTX 5060" passes the adapter's `GeForce` filter but is a water
 * block, so it must NOT be shown as a 5060 GPU. Matched case-insensitively
 * with word boundaries. Keep conservative: real RTX 50-series card titles
 * ("GeForce RTX 5060 8G GAMING OC", etc.) contain none of these.
 */
const ACCESSORY_RE =
  /\b(water\s*block|waterblock|water[-\s]?cooled|cooler|cooling\s*kit|heatsink|heat\s*sink|thermal\s*pad|thermal\s*paste|thermal\s*compound|thermal\s*grease|backplate|back\s*plate|back-?plate|radiator|pump|reservoir|bracket|vertical\s*mount|vertical\s*kit|mounting\s*kit|mount\s*kit|\bmount\b|holder|stand|riser|extension\s*cable|power\s*cable|12vhpwr|powerlink|\bpsu\b|power\s*supply|fan\s*kit|replacement\s*fan|case\s*fan|screw|standoff|support\s*bracket|gpu\s*holder|gpu\s*support|graphics\s*card\s*holder)\b/i;

/**
 * Classify a listing's category from its title AND the classified GPU model.
 *
 * - No model match → "other" (drop — the listing isn't for a tracked GPU).
 * - Model match + VRAM mention (GDDR) → "gpu". A listing that carries a
 *   memory spec IS the graphics card itself, even when it's a liquid-cooled
 *   hybrid card (e.g. "ASUS ROG Astral LC … 32GB GDDR7"). Water blocks, coolers,
 *   brackets, risers and PSUs never carry VRAM specs, so this guard prevents
 *   mis-tagging hybrid cards as accessories.
 * - Model match + accessory keyword (and no VRAM) → "accessory" (a part FOR
 *   the card).
 * - Model match, otherwise → "gpu" (the card).
 *
 * `model` should be the result of `classifyGpuModel(title)`; passing it in
 * avoids re-running the model regex. Returns "other" when no model is known.
 */
export function classifyListingCategory(
  title: string | null | undefined,
  model: string | null,
): ListingCategory {
  if (!model) return "other";
  if (!title) return "gpu";
  // A laptop (whole notebook or laptop-class "Laptop GPU") is NOT a desktop
  // card — check this BEFORE the GDDR/"Graphics Card" guard, since a laptop
  // listing can mention "GDDR7" (the GPU inside has VRAM) yet still be a
  // laptop, not a discrete desktop card.
  if (LAPTOP_RE.test(title)) return "laptop";
  // A prebuilt desktop PC (whole gaming tower that CONTAINS the GPU) is NOT a
  // discrete card — check this BEFORE the GDDR/"Graphics Card" guard, since a
  // desktop listing mentions "GeForce RTX 5090 32GB GDDR7" (the card inside)
  // yet is a whole PC. Match explicit desktop keywords, or a standalone
  // "desktop" (unless it's "desktop graphics card"), or a CPU model in the
  // title (cards never carry CPU specs).
  if (DESKTOP_RE.test(title)) return "desktop";
  if (/\bdesktop\b/i.test(title) && !/\b(graphics\s*card|video\s*card)\b/i.test(title)) return "desktop";
  if (model && CPU_RE.test(title)) return "desktop";
  // A PC case or chassis that mentions GPU compatibility is an accessory,
  // never the graphics card itself.
  if (CASE_RE.test(title)) return "accessory";
  // A listing that carries a GPU-card signal IS the card itself, even when it's
  // a liquid-cooled hybrid card ("ASUS ROG Astral LC … 32GB GDDR7") or a
  // bundle ("MSI GeForce RTX 5060 Ti 8G … Graphics Card + Power Supply MAG").
  // Water blocks, coolers, brackets, risers and standalone PSUs never carry
  // VRAM specs ("GDDR") or call themselves a "Graphics Card"/"Video Card",
  // so this guard prevents mis-tagging hybrid cards and bundles as accessories.
  if (/\b(GDDR|Graphics\s*Card|Video\s*Card)\b/i.test(title)) return "gpu";
  return ACCESSORY_RE.test(title) ? "accessory" : "gpu";
}
