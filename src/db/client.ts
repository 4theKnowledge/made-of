import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Postgres client. We keep a lazy singleton so route handlers, scripts and
 * tests all share one connection pool.
 */
// Persist across Next.js dev HMR re-evaluations. Without this, every
// module reload builds a fresh postgres() pool while the previous pool's
// sockets stay open, and ~10 edits exhaust Postgres's max_connections.
type PgCache = {
  client: ReturnType<typeof postgres> | null;
  db: ReturnType<typeof drizzle<typeof schema>> | null;
};
const globalCache = globalThis as unknown as { __madeofPg?: PgCache };
const cache: PgCache = (globalCache.__madeofPg ??= { client: null, db: null });

function createClient(url: string, max: number) {
  return postgres(url, {
    max,
    prepare: false,
    onnotice: () => {},
  });
}

export function getDb(url: string = requireUrl(), max = 10) {
  if (cache.db) return cache.db;
  cache.client = createClient(url, max);
  cache.db = drizzle(cache.client, { schema, casing: "snake_case" });
  return cache.db;
}

export function getRawClient() {
  if (!cache.client) getDb();
  return cache.client!;
}

export async function closeDb() {
  if (cache.client) {
    await cache.client.end({ timeout: 5 });
    cache.client = null;
    cache.db = null;
  }
}

function requireUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres instance.",
    );
  }
  return url;
}

export type Db = ReturnType<typeof getDb>;
export { schema };
