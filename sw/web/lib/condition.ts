import { NEWEGG_OPEN_BOX_ITEM_RE, NEWEGG_REFURB_ITEM_RE, RENEWED_OR_REFURBISHED_RE } from "@stockwatch/adapters";

import type { WatchView } from "./demo";

/** The snapshot fields that carry a condition signal. */
export interface ConditionSource {
  /** `raw->>'condition'` written by the poller ("refurbished" | "open_box" | "used"); NULL ⇒ new. */
  condition?: string | null;
  title?: string | null;
  canonical_title?: string | null;
  url?: string | null;
  mpn?: string | null;
  retailer?: string | null;
}

/**
 * Resolve a listing's condition for the dashboard badge. The poller's stored
 * `condition` is authoritative; the title/SKU heuristics only matter for
 * rows written before the poller recorded it (and for retailers that signal
 * refurb purely through the title).
 */
export function listingCondition(s: ConditionSource): NonNullable<WatchView["condition"]> {
  const c = (s.condition ?? "").toLowerCase();
  if (c === "refurbished" || c === "renewed" || c === "recertified") return "refurbished";
  if (c === "open_box" || c === "open box") return "open_box";
  if (c === "used" || c === "pre-owned") return "used";

  const title = s.title ?? "";
  const canon = s.canonical_title ?? "";
  if (/\bopen[\s-]?box\b/i.test(`${title} ${canon}`)) return "open_box";
  if (/\bpre-owned\b/i.test(`${title} ${canon}`)) return "used";
  if (RENEWED_OR_REFURBISHED_RE.test(title) || RENEWED_OR_REFURBISHED_RE.test(canon)) return "refurbished";

  // Newegg: item number is the last URL path segment after /p/ (`mpn` may
  // hold the model instead). `…T` = refurbished, `…R` = open box, `9UC…` = used.
  if (s.retailer === "newegg") {
    const item = s.url?.match(/\/p\/([^/?#]+)/i)?.[1] ?? "";
    for (const id of [item, s.mpn ?? ""]) {
      if (NEWEGG_REFURB_ITEM_RE.test(id)) return "refurbished";
      if (NEWEGG_OPEN_BOX_ITEM_RE.test(id)) return "open_box";
      if (/^9UC/i.test(id)) return "used";
    }
  }
  return "new";
}
