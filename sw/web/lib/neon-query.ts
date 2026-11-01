import { neon } from "@neondatabase/serverless";

/**
 * Neon HTTP query client (singleton).
 *
 * Why this exists alongside the postgres-js `getDb()` client:
 *   postgres-js speaks raw TCP+TLS to Neon. Over a high-latency link (e.g.
 *   cross-continent to Neon us-east-2) it transfers multi-row results very
 *   slowly — the ~1100-row latest-snapshot query takes 24-34s through
 *   postgres-js but only ~2.7s through psql. The gap is in JS TLS/chunk handling.
 *
 *   @neondatabase/serverless uses HTTP fetch instead, which streams the
 *   whole result in one response — measured at ~4.6s for the same 200KB
 *   payload, a 5-7x speedup. We route the loadData read queries through
 *   this HTTP client and run them in parallel, keeping loadData under ~5s
 *   so the dashboard stays in DB mode (per-country listings, matrix, per-MPN
 *   images from every retailer) instead of falling back to Newegg-only live.
 */
let _sql: ReturnType<typeof neon> | null = null;

export function getNeon(): ReturnType<typeof neon> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql;
}

/**
 * Run a SQL query through Neon's HTTP driver and return typed rows.
 * Results come back as plain JS objects (JSON-parsed over the HTTP boundary).
 */
export async function neonQuery<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
  const sql = getNeon();
  return (await sql(strings as any, ...values)) as unknown as T[];
}
