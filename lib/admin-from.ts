const APEX = "snaphubglobal.com";

/** Allow in-site paths or same-apex absolute URLs (stockwatch subdomain). */
export function safeAdminFrom(from: string | null | undefined): string {
  if (!from) return "/mobile";
  if (from.startsWith("/") && !from.startsWith("//")) return from;
  try {
    const url = new URL(from);
    if (url.hostname === APEX || url.hostname.endsWith(`.${APEX}`)) return from;
  } catch {
    /* ignore */
  }
  return "/mobile";
}
