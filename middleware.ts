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

function isAdminApi(pathname: string) {
  return (
    pathname === "/api/stream" ||
    pathname.startsWith("/api/watches") ||
    pathname.startsWith("/api/img") ||
    pathname.startsWith("/api/history") ||
    pathname.startsWith("/api/snapshots")
  );
}

function isAdminPage(pathname: string) {
  return (
    pathname === "/mobile" ||
    pathname === "/stock" ||
    pathname.startsWith("/stock/") ||
    (pathname.startsWith("/mobile/") &&
      !pathname.startsWith("/mobile/login") &&
      !pathname.startsWith("/mobile/api/"))
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!isAdminPage(pathname) && !isAdminApi(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get("snaphub_admin")?.value;
  const secret = process.env.SESSION_SECRET;
  const ok = Boolean(secret && token && (await verifyToken(token, secret)));

  if (ok) return NextResponse.next();

  if (isAdminApi(pathname)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/mobile/login", req.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/mobile",
    "/mobile/:path*",
    "/stock",
    "/stock/:path*",
    "/api/stream",
    "/api/watches",
    "/api/img",
    "/api/history",
    "/api/snapshots",
  ],
};
