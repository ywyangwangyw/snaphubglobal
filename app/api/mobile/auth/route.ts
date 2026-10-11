import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

export const runtime = "nodejs";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function makeToken(secret: string): string {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = `admin:${expires}`;
  const sig = sign(payload, secret);
  return `${payload}.${sig}`;
}

function verifyToken(token: string, secret: string): boolean {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  const expected = sign(payload, secret);
  if (sig !== expected) return false;
  const parts = payload.split(":");
  const expires = Number(parts[1]);
  if (!Number.isFinite(expires)) return false;
  return Date.now() / 1000 < expires;
}

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

  const password = body.password;
  if (!password || password !== adminPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = makeToken(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("snaphub_admin", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return res;
}

export function GET() {
  return NextResponse.json({ error: "Use POST to authenticate" }, { status: 405 });
}
