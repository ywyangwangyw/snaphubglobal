import { desc, eq } from "drizzle-orm";

import { getDb, snapshots } from "@stockwatch/db";

/** GET /api/snapshots?watchId=...&limit=100 — recent snapshots for a watch. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const watchId = url.searchParams.get("watchId");
  const limit = Number(url.searchParams.get("limit") ?? 100);

  const db = getDb();
  const q = db
    .select({
      id: snapshots.id,
      watchId: snapshots.watchId,
      productId: snapshots.productId,
      retailer: snapshots.retailer,
      inStock: snapshots.inStock,
      status: snapshots.status,
      price: snapshots.price,
      shipping: snapshots.shipping,
      seller: snapshots.seller,
      title: snapshots.title,
      url: snapshots.url,
      createdAt: snapshots.createdAt,
    })
    .from(snapshots)
    .orderBy(desc(snapshots.createdAt))
    .limit(Math.min(limit, 1000));

  const rows = watchId ? await q.where(eq(snapshots.watchId, watchId)) : await q;
  return Response.json(rows);
}
