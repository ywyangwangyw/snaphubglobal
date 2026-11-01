import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/img?u=<encoded image url>
 *
 * Image proxy with a Neon-backed byte cache.
 *
 * Problem: Newegg's CDN (c1.neweggimages.com / Akamai) rejects requests from
 * datacenter/VPN IPs with HTTP 400 — even when the VPN egresses from the US.
 * So a local dev server behind a VPN can't fetch Newegg thumbnails, even
 * though production (Vercel US IPs) can. Amazon/MSI/LDLC/BestBuy CDNs don't
 * have this problem, but routing everything through one cache is simpler.
 *
 * Solution: the poller (GitHub Actions, US IPs) fetches and caches every
 * listing's image bytes in the `listing_images` table (keyed by URL hash).
 * This route checks that cache FIRST — if found, it streams the cached
 * bytes, which works from any IP (Neon HTTP). If not cached, it falls back
 * to a live CDN fetch (works from Vercel US, fails from VPN) and caches the
 * result so subsequent requests — including from a local dev server — hit
 * the cache.
 *
 * On any failure (cache miss + CDN 400/404, network error) it returns HTTP
 * 404 so the browser fires <img onError> and the ThumbImg component reveals
 * the neutral placeholder.
 */

function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  if (!u || !/^https?:\/\//i.test(u)) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
  }

  const urlHash = hashUrl(u);

  // 1. Check the Neon-backed byte cache. The poller (US IPs) populates this;
  // a hit serves the image from any IP — including a local dev server behind
  // a VPN that the retailer's CDN would block.
  try {
    const cached = await readCachedImage(urlHash);
    if (cached) {
      return new Response(new Uint8Array(cached.data), {
        headers: {
          "Content-Type": cached.contentType,
          "Cache-Control": "public, max-age=86400, immutable",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  } catch {
    // cache read failed — fall through to live fetch
  }

  // 2. Cache miss — fetch from the retailer's CDN. This works from Vercel's
  // US IPs in production. From a local dev server behind a VPN it may fail
  // (Newegg/Akamai 400), in which case the poller will cache the image on
  // its next tick and the browser will hit the cache on reload.
  try {
    const r = await fetch(u, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: new URL(u).origin + "/",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
      },
      redirect: "follow",
    });
    if (r.ok && /^image\//i.test(r.headers.get("content-type") ?? "")) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 0) {
        // Best-effort: write back to the cache so the next request hits it.
        void writeCachedImage(urlHash, u, buf, r.headers.get("content-type") ?? "image/jpeg");
        return new Response(buf, {
          headers: {
            "Content-Type": r.headers.get("content-type") ?? "image/jpeg",
            "Cache-Control": "public, max-age=86400, immutable",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }
  } catch {
    // fall through to 404
  }

  return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
}

/** Read a cached image from Neon via the HTTP driver. Returns the raw bytes
 *  + content type, or null if not cached. Uses `encode(data, 'base64')` so
 *  the bytea column crosses the HTTP boundary as a base64 string. */
async function readCachedImage(
  urlHash: string,
): Promise<{ data: Buffer; contentType: string } | null> {
    const { neonQuery } = await import("@sw/lib/neon-query");
  const rows = await neonQuery<{ b64: string; content_type: string }>`
    SELECT encode(data, 'base64') AS b64, content_type
    FROM listing_images
    WHERE url_hash = ${urlHash}
    LIMIT 1
  `;
    if (rows.length === 0) return null;
    const row = rows[0]!;
    return {
      data: Buffer.from(row.b64, "base64"),
      contentType: row.content_type,
    };
}

/** Best-effort write to the image cache. Never throws — a cache write
 *  failure just means the next request re-fetches from the CDN. */
async function writeCachedImage(
  urlHash: string,
  url: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  try {
    const { neonQuery } = await import("@sw/lib/neon-query");
    // The Neon HTTP driver accepts parameterized queries; pass the bytea as
    // hex-encoded text and cast in SQL (the HTTP driver doesn't support raw
    // Buffer params, so we encode as hex and decode with decode($1::text, 'hex')).
    await neonQuery`
      INSERT INTO listing_images (url_hash, url, data, content_type)
      VALUES (${urlHash}, ${url}, decode(${data.toString("hex")}, 'hex'), ${contentType})
      ON CONFLICT (url_hash) DO NOTHING
    `;
  } catch {
    // best-effort — ignore
  }
}
