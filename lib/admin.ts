import { createHmac } from "crypto";

export const ADMIN_COOKIE = "snaphub_admin";
export const ADMIN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const APEX = "snaphubglobal.com";

export function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function makeAdminToken(secret: string): string {
  const expires = Math.floor(Date.now() / 1000) + ADMIN_MAX_AGE_SECONDS;
  const payload = `admin:${expires}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyAdminToken(token: string | undefined, secret: string): boolean {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (sign(payload, secret) !== sig) return false;
  const expires = Number(payload.split(":")[1]);
  return Number.isFinite(expires) && Date.now() / 1000 < expires;
}

/** Cookie Domain so stockwatch.snaphubglobal.com can read the same login. */
export function adminCookieOptions(hostname?: string) {
  const onApex = Boolean(hostname && (hostname === APEX || hostname.endsWith(`.${APEX}`)));
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: ADMIN_MAX_AGE_SECONDS,
    ...(onApex ? { domain: `.${APEX}` } : {}),
  };
}

