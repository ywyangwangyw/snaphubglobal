import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let _db: Database | null = null;
let _client: ReturnType<typeof postgres> | null = null;

/** Create a fresh Postgres + Drizzle client from DATABASE_URL.
 *  `max: 1` + `prepare: false` keeps a single, simple connection — ideal for a
 *  long-running poller against Neon's serverless pooler, where idle pooled
 *  connections can be killed by a compute suspend/restart (Postgres `57P02`). */
export function createDb(url: string = process.env.DATABASE_URL ?? "") {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 30,
    connection: { application_name: "stockwatch" },
    onnotice: () => {},
  });
  return { db: drizzle(client, { schema }), client };
}

/** Singleton accessor for use in hot-reloading environments (Next.js dev). */
export function getDb(): Database {
  if (!_db) {
    const built = createDb();
    _db = built.db;
    _client = built.client;
  }
  return _db;
}

/** Dispose the current client and force the next `getDb()` to open a fresh
 *  connection. Call after a fatal/`CONNECTION_CLOSED` error so the poller
 *  recovers instead of staying wedged on a dead socket. */
export async function resetDb(): Promise<void> {
  try {
    if (_client) await _client.end({ timeout: 2 });
  } catch {
    /* ignore */
  }
  _db = null;
  _client = null;
}
