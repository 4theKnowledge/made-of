/**
 * In-memory token-bucket rate limiter.
 *
 * One `RateLimiter` instance per route, keyed by visitor identity. Visitor
 * identity is Cloudflare's `CF-Connecting-IP` header when signed out, or the
 * user id when signed in (phase 4 wires this up). In dev we fall back to the
 * request's own `x-forwarded-for` so you can test by hitting from curl.
 *
 * The counters are process-local. That is fine for a single Railway web
 * service (CLAUDE.md says: single instance for now). If replicas are added,
 * move the bucket store to Postgres with the counters in a dedicated table.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export interface RateLimitConfig {
  /** Permits per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

interface Bucket {
  /** Fractional tokens remaining. */
  tokens: number;
  /** Last refill timestamp (ms). */
  lastRefill: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: RateLimitConfig) {}

  /**
   * Attempt to consume one token. Returns:
   *   - { ok: true, remaining, resetMs } when permitted
   *   - { ok: false, remaining: 0, retryAfterMs, resetMs } when limited
   */
  take(key: string, now = Date.now()):
    | { ok: true; remaining: number; resetMs: number }
    | { ok: false; remaining: 0; retryAfterMs: number; resetMs: number } {
    const { limit, windowMs } = this.config;
    const refillRate = limit / windowMs; // tokens per ms
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: limit, lastRefill: now };
      this.buckets.set(key, b);
    } else {
      const elapsed = now - b.lastRefill;
      if (elapsed > 0) {
        b.tokens = Math.min(limit, b.tokens + elapsed * refillRate);
        b.lastRefill = now;
      }
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return {
        ok: true,
        remaining: Math.floor(b.tokens),
        resetMs: Math.ceil((limit - b.tokens) / refillRate),
      };
    }
    const needed = 1 - b.tokens;
    const retryAfterMs = Math.ceil(needed / refillRate);
    return {
      ok: false,
      remaining: 0,
      retryAfterMs,
      resetMs: retryAfterMs,
    };
  }

  /** For tests and admin: wipe all buckets. */
  reset() {
    this.buckets.clear();
  }

  size() {
    return this.buckets.size;
  }
}

/* ========================================================================
 * Pre-configured limiters, matching the API design table in
 * docs/IMPLEMENTATION.md.
 *
 * These are module-level singletons so the counters survive across requests
 * within one Node process.
 * ====================================================================== */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const limiters = {
  items: new RateLimiter({ limit: 60, windowMs: MINUTE }),
  evidence: new RateLimiter({ limit: 30, windowMs: MINUTE }),
  search: new RateLimiter({ limit: 30, windowMs: MINUTE }),
  pathPerUser: new RateLimiter({ limit: 10, windowMs: MINUTE }),
  pathAnonDaily: new RateLimiter({ limit: 5, windowMs: DAY }),
  everythingPerUser: new RateLimiter({ limit: 10, windowMs: MINUTE }),
  daily: new RateLimiter({ limit: 30, windowMs: MINUTE }),
  dailyMove: new RateLimiter({ limit: 120, windowMs: MINUTE }),
  dailyResult: new RateLimiter({ limit: 10, windowMs: MINUTE }),
  scratch: new RateLimiter({ limit: 120, windowMs: MINUTE }),
  reports: new RateLimiter({ limit: 10, windowMs: HOUR }),
};

/** Reset every limiter — tests use this between runs. */
export function resetAllLimiters() {
  for (const l of Object.values(limiters)) l.reset();
}

/* ========================================================================
 * Request helpers.
 * ====================================================================== */

/** Visitor identity key for anonymous rate limits. */
export function visitorKey(req: NextRequest): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return `ip:${cf}`;
  // Dev fallback: trust the first x-forwarded-for or the next-url hostname.
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return `ip:${xff}`;
  return "ip:unknown";
}

/** Wrap a route handler with a rate limit, returning 429 when exceeded. */
export async function withRateLimit<T>(
  _req: NextRequest,
  limiter: RateLimiter,
  key: string,
  handler: () => Promise<T> | T,
): Promise<Response | T> {
  const result = limiter.take(key);
  if (!result.ok) {
    const retryS = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    return new NextResponse(
      JSON.stringify({ error: "rate_limited", retryAfter: retryS }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(retryS),
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.ceil(result.resetMs / 1000)),
        },
      },
    );
  }
  const body = await handler();
  if (body instanceof Response) {
    body.headers.set("x-ratelimit-remaining", String(result.remaining));
    body.headers.set(
      "x-ratelimit-reset",
      String(Math.ceil(result.resetMs / 1000)),
    );
  }
  return body;
}
