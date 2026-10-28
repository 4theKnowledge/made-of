import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows up to limit then rejects", () => {
    const rl = new RateLimiter({ limit: 3, windowMs: 60_000 });
    expect(rl.take("a", 0).ok).toBe(true);
    expect(rl.take("a", 1).ok).toBe(true);
    expect(rl.take("a", 2).ok).toBe(true);
    const r = rl.take("a", 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills tokens over time", () => {
    // Refill rate = limit / windowMs. 2 per 1000ms => 1 token refills every
    // 500ms.
    const rl = new RateLimiter({ limit: 2, windowMs: 1000 });
    expect(rl.take("a", 0).ok).toBe(true); // 2 -> 1
    expect(rl.take("a", 0).ok).toBe(true); // 1 -> 0
    expect(rl.take("a", 0).ok).toBe(false); // 0, denied
    // 100ms later: 0 + 0.2 = 0.2 tokens, still under 1.
    expect(rl.take("a", 100).ok).toBe(false);
    // 500ms past the last refill: 0.2 + 400*0.002 = 1.0 — allowed.
    expect(rl.take("a", 500).ok).toBe(true);
  });

  it("keys are independent", () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rl.take("a", 0).ok).toBe(true);
    expect(rl.take("b", 0).ok).toBe(true);
    expect(rl.take("a", 0).ok).toBe(false);
  });
});
