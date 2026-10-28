import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Postgres client. We keep a lazy singleton so route handlers, scripts and
 * tests all share one connection pool.
 */
let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function createClient(url: string, max: number) {
  return postgres(url, {
    max,
    prepare: false,
    onnotice: () => {},
  });
}

export function getDb(url: string = requireUrl(), max = 10) {
  if (_db) return _db;
  _client = createClient(url, max);
  _db = drizzle(_client, { schema, casing: "snake_case" });
  return _db;
}

export function getRawClient() {
  if (!_client) getDb();
  return _client!;
}

export async function closeDb() {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = null;
    _db = null;
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
