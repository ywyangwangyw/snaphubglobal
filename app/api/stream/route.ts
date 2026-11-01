import postgres from "postgres";

import { getDb, snapshots, products } from "@stockwatch/db";
import { sql } from "drizzle-orm";
import { listingCondition } from "@sw/lib/condition";

import { pollLiveUpdates, getPollStats } from "@sw/lib/live";
import { getNeon } from "@sw/lib/neon-query";
import { loadWatchQueue } from "@sw/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/stream — Server-Sent Events stream of new snapshots.
 *
 * Real mode: the poller worker writes a snapshot row and issues `NOTIFY
 * snapshot`; this endpoint subscribes via postgres.js and pushes each new row
 * to the browser. Poller and web app stay decoupled.
 *
 * Demo mode (no DATABASE_URL): emits a simulated snapshot every few seconds so
 * the live status lights visibly pulse and flip — a faithful preview of the
 * real behavior.
 */
export async function GET() {
  const enc = new TextEncoder();
  const url = process.env.DATABASE_URL;

  // --- Demo / live mode (no DATABASE_URL) -------------------------------
  // Polls the REAL Newegg adapter on a cadence and streams per-listing
  // updates, so the status lights reflect genuine stock/price changes.
  if (!url) {
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(enc.encode(": connected\n\n"));
        let stopped = false;
        const safeEnqueue = (chunk: Uint8Array) => {
          if (stopped) return;
          try {
            controller.enqueue(chunk);
          } catch {
            // Controller already closed (client disconnected) — stop trying.
            stopped = true;
          }
        };
        const sendStats = () =>
          safeEnqueue(enc.encode(`event: stats\ndata: ${JSON.stringify(getPollStats())}\n\n`));
        const runPoll = async () => {
          if (stopped) return;
          // Signal the UI to flip its row lights to "fetching" (purple) while
          // the network requests are in flight, then clear it when done.
          safeEnqueue(enc.encode("event: poll-start\ndata: {}\n\n"));
          try {
            for (const u of await pollLiveUpdates()) {
              safeEnqueue(enc.encode(`event: snapshot\ndata: ${JSON.stringify(u)}\n\n`));
            }
          } catch (err) {
            console.error("[stream] live poll failed:", err);
          } finally {
            safeEnqueue(enc.encode("event: poll-end\ndata: {}\n\n"));
            sendStats();
          }
        };
        // Push the current state immediately.
        await runPoll();
        // Self-reschedule: respect the poller's back-off so a 429 doesn't make
        // us hammer Newegg on a fixed 45s cadence. The next delay is derived
        // from getPollStats() (backoffUntil if set, else the base interval).
        const scheduleNext = () => {
          if (stopped) return;
          const s = getPollStats();
          let delayMs = 45_000;
          if (s.backoffUntil) {
            delayMs = Math.max(1_000, new Date(s.backoffUntil).getTime() - Date.now());
          }
          setTimeout(() => {
            if (stopped) return;
            void runPoll().finally(scheduleNext);
          }, delayMs);
        };
        scheduleNext();
        return () => { stopped = true; };
      },
    });
    return sseResponse(stream);
  }

  // --- Real mode -----------------------------------------------------------
  const listener = postgres(url, { max: 1, prepare: false });
  const db = getDb();

  let heartbeat: NodeJS.Timeout | null = null;
  let unsubscribe: postgres.SubscriptionHandle | null = null;
  let pollFallback: NodeJS.Timeout | null = null;
  // Set when the client disconnects so the poll fallback stops enqueuing
  // into a closed controller (which would throw ERR_INVALID_STATE).
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: snapshot\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller already closed (client gone) — stop further sends.
          closed = true;
        }
      };

      controller.enqueue(enc.encode(": connected\n\n"));

      const onNotification = async () => {
        // Emit the latest snapshot for EVERY listing (watch × SKU) so each
        // row in the dashboard updates. `mpn` holds the retailer SKU; one
        // SSE event per listing, keyed by <watchId>/<sku> to match loadData.
        // Join `products` to carry the per-product CATALOG image.
        //
        // PERF: aggregate the ~1100-row result into a SINGLE JSON row and fetch
        // through Neon's HTTP driver. Over a high-latency link to Neon,
        // per-row transfer via postgres-js's TCP+TLS costs ~19ms/row (1100
        // rows ≈ 24-34s); the same query through Neon HTTP with one
        // aggregated JSON row is ~4.6s (5-7x faster), keeping the SSE probe
        // well under the DB timeout so the stream stays in DB mode (per-MPN
        // images, per-country listings) instead of falling back to live.
        const neon = getNeon();
        const aggRows = (await neon`
          SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)::text AS data
          FROM (
            SELECT DISTINCT ON (s.watch_id, s.mpn)
              s.watch_id, s.product_id, s.retailer, s.country, s.category, s.in_stock, s.status, s.price,
              s.original_price, s.discount_amount, s.title, s.canonical_title,
              s.mpn, s.url, s.image_url, s.seller, s.created_at,
              coalesce(s.last_seen_at, s.created_at) AS seen_at,
              p.image_url AS product_image_url,
              s.raw->>'currency' AS currency,
              s.raw->>'condition' AS condition
            FROM snapshots s
            JOIN products p ON p.id = s.product_id
            JOIN watches w ON w.id = s.watch_id
            WHERE s.mpn IS NOT NULL AND s.mpn <> ''
            AND (
              (w.options->>'firstPartyOnly' IS DISTINCT FROM 'true' AND s.retailer = 'amazon')
              OR s.seller IS NULL
              OR s.seller = ''
              OR s.seller IN ('Amazon', 'MSI', 'Best Buy', 'LDLC', 'Newegg')
            )
            AND (
              s.retailer <> 'newegg'
              OR (s.url NOT LIKE '%/p/9SI%' AND s.url NOT LIKE '%/p/1FT%' AND s.mpn NOT LIKE '9SI%' AND s.mpn NOT LIKE '1FT%')
            )
            ORDER BY s.watch_id, s.mpn, s.created_at DESC
          ) t
        `) as unknown as Array<{ data: string }>;
        const rows = JSON.parse(aggRows[0]?.data ?? "[]") as Array<{
          watch_id: string;
          product_id: string;
          retailer: string;
          country: string;
          category: string | null;
          in_stock: boolean;
          status: string;
          price: string | null;
          original_price: string | null;
          discount_amount: string | null;
          title: string | null;
          canonical_title: string | null;
          mpn: string | null;
          url: string | null;
          image_url: string | null;
          seller: string | null;
          created_at: string;
          seen_at: string;
          product_image_url: string | null;
          currency: string | null;
          condition: string | null;
        }>;
        // Per-watch schedule (last poll / next due) so the Polling tab's
        // queue — and each row's "checked Xm ago" — stay current without a
        // page reload. Best-effort: a failure here never blocks snapshots.
        try {
          const queue = await loadWatchQueue();
          if (!closed) controller.enqueue(enc.encode(`event: queue\ndata: ${JSON.stringify(queue)}\n\n`));
        } catch (err) {
          console.warn("[stream] queue refresh failed:", err instanceof Error ? err.message : err);
        }
        for (const s of rows) {
          const condition = listingCondition(s);

          send({
            watchId: s.mpn ? `${s.watch_id}/${s.mpn}` : s.watch_id,
            productId: s.product_id,
            retailer: s.retailer,
            country: s.country,
            category: s.category ?? "gpu",
            condition,
            currency: s.currency ?? null,
            inStock: s.in_stock,
            status: s.status,
            price: s.price,
            originalPrice: s.original_price,
            discountAmount: s.discount_amount,
            title: s.canonical_title ?? s.title,
            mpn: s.mpn,
            imageUrl: s.image_url,
            productImageUrl: s.product_image_url,
            seller: s.seller,
            url: s.url,
            updatedAt: s.seen_at ?? s.created_at,
          });
        }
      };

      // Try logical-decoding NOTIFY subscription first. Some hosted Postgres
      // providers (e.g. Neon's free plan) don't enable `wal_level=logical`, so
      // `subscribe` throws — fall back to polling the latest snapshot on a
      // cadence so the live status lights still pulse without NOTIFY.
      let usingLive = false;
      // Live-poll fallback: when the DB is throttled (Neon over quota), DB
      // queries take 30-180s and the SSE never delivers events in time. This
      // mirrors the no-DATABASE_URL branch — polls the real Newegg adapter and
      // streams LiveUpdates as snapshot events (LiveUpdate now carries
      // retailer/country/category/currency + the catalog image, so the
      // dashboard handler accepts it as a snapshot).
      const runLivePoll = async () => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode("event: poll-start\ndata: {}\n\n"));
          for (const u of await pollLiveUpdates()) {
            if (closed) return;
            try {
              controller.enqueue(enc.encode(`event: snapshot\ndata: ${JSON.stringify(u)}\n\n`));
            } catch {
              closed = true;
            }
          }
        } catch (err) {
          console.error("[stream] live poll failed:", err);
        } finally {
          if (!closed) {
            try {
              controller.enqueue(enc.encode("event: poll-end\ndata: {}\n\n"));
              controller.enqueue(enc.encode(`event: stats\ndata: ${JSON.stringify(getPollStats())}\n\n`));
            } catch {
              closed = true;
            }
          }
        }
      };
      // Race the first DB snapshot query against a timeout. Over a
      // high-latency link the Neon HTTP query takes ~5-10s, so 20s gives
      // headroom; only a truly unreachable DB switches to live polling.
      const DB_TIMEOUT_MS = 20_000;
      try {
        unsubscribe = await listener.subscribe("snapshot", () => {
          if (!usingLive) void onNotification();
        });
      } catch (err) {
        console.warn(
          "[stream] NOTIFY subscribe unavailable, falling back to polling:",
          err instanceof Error ? err.message : err,
        );
        // Probe the DB with a timeout. If it responds fast, poll the DB on a
        // 60s cadence (keeps Neon on the free tier). If it's slow, switch to
        // live polling (real Newegg adapter) so the UI still updates.
        const probe = Promise.race([
          onNotification(),
          new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), DB_TIMEOUT_MS)),
        ]);
        if ((await probe) === "timeout") {
          console.warn("[stream] DB snapshot too slow — switching to live polling");
          usingLive = true;
          void runLivePoll();
          const scheduleLiveNext = () => {
            if (closed) return;
            const s = getPollStats();
            let delayMs = 45_000;
            if (s.backoffUntil) delayMs = Math.max(1_000, new Date(s.backoffUntil).getTime() - Date.now());
            pollFallback = setTimeout(() => {
              if (closed) return;
              void runLivePoll().finally(scheduleLiveNext);
            }, delayMs);
          };
          scheduleLiveNext();
        } else {
          pollFallback = setInterval(() => void onNotification(), 60_000);
        }
      }

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          /* controller already closed */
        }
      }, 25_000);
    },
    async cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (pollFallback) clearInterval(pollFallback);
      try {
        unsubscribe?.unsubscribe();
      } catch {
        /* ignore */
      }
      await listener.end();
    },
  });

  return sseResponse(stream);
}

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
