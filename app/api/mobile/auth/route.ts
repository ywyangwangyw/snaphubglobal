import { NextRequest, NextResponse } from "next/server";
import { adminCookieOptions, ADMIN_COOKIE, makeAdminToken } from "@/lib/admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!secret || !adminPassword) {
    return NextResponse.json(
      { error: "Server not configured. Set ADMIN_PASSWORD and SESSION_SECRET in .env.local" },
      { status: 500 },
    );
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.password || body.password !== adminPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, makeAdminToken(secret), adminCookieOptions(req.nextUrl.hostname));
  return res;
}

export function GET() {
  return NextResponse.json({ error: "Use POST to authenticate" }, { status: 405 });
}
