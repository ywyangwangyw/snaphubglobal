import { NextRequest, NextResponse } from "next/server";

async function verifyToken(token: string, secret: string): Promise<boolean> {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expectedBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const expected = Array.from(new Uint8Array(expectedBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (sig !== expected) return false;
    const parts = payload.split(":");
    const expires = Number(parts[1]);
    if (!Number.isFinite(expires)) return false;
    return Date.now() / 1000 < expires;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only protect /mobile (but allow /mobile/login and API routes through)
  if (
    pathname === "/mobile" ||
    (pathname.startsWith("/mobile/") &&
     !pathname.startsWith("/mobile/login") &&
     !pathname.startsWith("/mobile/api/"))
  ) {
    const token = req.cookies.get("snaphub_admin")?.value;
    const secret = process.env.SESSION_SECRET;

    if (!secret) {
      return NextResponse.redirect(new URL("/mobile/login", req.url));
    }

    if (!token || !(await verifyToken(token, secret))) {
      const loginUrl = new URL("/mobile/login", req.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/mobile/:path*"],
};
