/**
 * Reconcile parsing for useCombineRun (T-0181).
 *
 * The hook can't be driven from this test env (no DOM, no
 * @testing-library/react), but the 409 → ReconcileEvent mapping is
 * pure. Exercise it directly — anything beyond this is better covered
 * by Playwright once we have a UAT harness.
 */

import { describe, expect, it } from "vitest";
import { parseReconcile } from "./useCombineRun";
import type { GameState } from "./engine";

const FAKE_STATE = { score: 42 } as unknown as GameState;

describe("parseReconcile", () => {
  it("maps event-count mismatch to reason='event-count'", () => {
    const event = parseReconcile({
      error: "event count mismatch",
      serverEventCount: 7,
      state: FAKE_STATE,
      epoch: 1,
    });
    expect(event).toEqual({
      reason: "event-count",
      runId: null,
      state: FAKE_STATE,
      eventCount: 7,
      epoch: 1,
    });
  });

  it("maps engineVersionMismatch to reason='engine-version'", () => {
    const event = parseReconcile({
      error: "engine version mismatch",
      engineVersionMismatch: true,
      serverEventCount: 3,
      state: FAKE_STATE,
      epoch: 2,
    });
    expect(event.reason).toBe("engine-version");
    expect(event.state).toBe(FAKE_STATE);
    expect(event.eventCount).toBe(3);
    expect(event.epoch).toBe(2);
  });

  it("maps 'run not active' to reason='run-ended' with null state", () => {
    const event = parseReconcile({
      error: "run not active",
      epoch: 1,
    });
    expect(event.reason).toBe("run-ended");
    expect(event.state).toBeNull();
    expect(event.eventCount).toBeNull();
    expect(event.epoch).toBe(1);
  });

  it("falls back to event-count for unknown error text", () => {
    // Defensive — if the server ever ships a new 409 reason we haven't
    // taught the client about, we still rewind to its event count
    // rather than throwing.
    const event = parseReconcile({
      error: "some new 409 reason we haven't seen",
      serverEventCount: 4,
      state: FAKE_STATE,
      epoch: 1,
    });
    expect(event.reason).toBe("event-count");
    expect(event.state).toBe(FAKE_STATE);
  });

  it("tolerates missing fields without throwing", () => {
    const event = parseReconcile({});
    expect(event.reason).toBe("event-count");
    expect(event.state).toBeNull();
    expect(event.eventCount).toBeNull();
    expect(event.epoch).toBeNull();
  });

  it("engine-version takes precedence over event-count ordering", () => {
    // The server only sets engineVersionMismatch=true when that's the
    // actual reason; a stored run that's also behind the version check
    // should still report engine-version so the client can take the
    // "give up and start fresh" branch.
    const event = parseReconcile({
      error: "engine version mismatch",
      engineVersionMismatch: true,
      serverEventCount: 0,
      state: FAKE_STATE,
      epoch: 2,
    });
    expect(event.reason).toBe("engine-version");
  });
});
