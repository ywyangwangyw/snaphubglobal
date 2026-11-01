import { randomUUID } from "node:crypto";
import { and, eq, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb, products, watches } from "@stockwatch/db";

/** Bounds for an admin-set poll interval: 1 minute … 1 day. */
const MIN_INTERVAL_SEC = 60;
const MAX_INTERVAL_SEC = 86_400;

/** PATCH /api/watches — enable/disable and/or re-time a slice of the watch set.
 *
 *  Body: `{ enabled?: boolean, pollIntervalSec?: number,
 *           retailer?: string, country?: string, productId?: string, watchId?: string }`
 *  At least one change and one selector are required; selectors AND together,
 *  so `{ country: "DE" }` is a whole country, `{ retailer: "amazon", country: "DE" }`
 *  is one storefront and `{ retailer, country, productId }` is one product at
 *  one storefront (its search watch plus any product-URL watches). The poller
 *  reads `enabled` / `poll_interval_sec` at the start of every cron run and on
 *  every daemon reconcile, so changes take effect within a cycle without a
 *  redeploy. Returns the ids it touched so the client can update optimistically. */
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    enabled?: unknown;
    pollIntervalSec?: unknown;
    retailer?: unknown;
    country?: unknown;
    productId?: unknown;
    watchId?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "JSON body required" }, { status: 400 });

  const set: { enabled?: boolean; pollIntervalSec?: number } = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    set.enabled = body.enabled;
  }
  if (body.pollIntervalSec !== undefined) {
    const sec = Number(body.pollIntervalSec);
    if (!Number.isInteger(sec) || sec < MIN_INTERVAL_SEC || sec > MAX_INTERVAL_SEC) {
      return NextResponse.json({ error: `pollIntervalSec must be an integer between ${MIN_INTERVAL_SEC} and ${MAX_INTERVAL_SEC}` }, { status: 400 });
    }
    set.pollIntervalSec = sec;
  }
  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "enabled and/or pollIntervalSec is required" }, { status: 400 });
  }

  const sel: SQL[] = [];
  if (typeof body.retailer === "string" && body.retailer) sel.push(eq(watches.retailer, body.retailer));
  if (typeof body.country === "string" && body.country) sel.push(eq(watches.country, body.country));
  if (typeof body.productId === "string" && body.productId) sel.push(eq(watches.productId, body.productId));
  if (typeof body.watchId === "string" && body.watchId) sel.push(eq(watches.id, body.watchId));
  if (sel.length === 0) {
    return NextResponse.json({ error: "at least one of retailer, country, productId, watchId is required" }, { status: 400 });
  }

  const db = getDb();
  const rows = await db
    .update(watches)
    .set(set)
    .where(and(...sel))
    .returning({ id: watches.id });
  return NextResponse.json({ ...set, updated: rows.length, ids: rows.map((r) => r.id) });
}

/** POST /api/watches — create a product + a watch for a retailer. */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    name: string;
    retailer: string;
    query: string;
    pollIntervalSec?: number;
  };

  if (!body.name || !body.retailer || !body.query) {
    return NextResponse.json({ error: "name, retailer, query are required" }, { status: 400 });
  }

  const db = getDb();
  const productId = randomUUID();
  const watchId = randomUUID();

  await db.insert(products).values({
    id: productId,
    name: body.name,
  });

  await db.insert(watches).values({
    id: watchId,
    productId,
    retailer: body.retailer,
    query: body.query,
    pollIntervalSec: body.pollIntervalSec ?? 300,
    enabled: true,
  });

  return NextResponse.json({ productId, watchId });
}
