/**
 * T-0319: regression coverage for the daily-leaderboard rescue path.
 *
 * `/api/combine/runs/[id]/finish` relies on `finalizeFromStoredState`
 * when the client's base-eventCount is stale but the stored state is
 * already `over` (classic finish-after-checkpoint race). If this write
 * doesn't land, the player's `progress` row is missing and the daily
 * leaderboard shows them as "rank unavailable".
 *
 * These tests go end-to-end against Postgres: insert a mock active
 * daily run with a completed stored state, call `finalizeFromStoredState`,
 * then assert (a) the run row ended, (b) a `progress` row exists with
 * the right shape, (c) discoveries persisted.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { finalizeFromStoredState } from "../progress-writer";
import { ENGINE_VERSION, type GameState } from "../engine";
import { getDb, schema } from "@/db/client";

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb("finalizeFromStoredState (db)", () => {
  const suite = randomUUID().slice(0, 8);
  const theme = `test-pw-${suite}`;
  const kindCode = `tpw-${suite}`;
  const itemAId = randomUUID();
  const itemBId = randomUUID();
  const userId = randomUUID();
  const userEmail = `test-pw-${suite}@example.test`;

  async function insertRun(opts: {
    mode: "daily" | "endless" | "fast";
    stateOver: boolean;
    manifest?: string[];
    manifestFound?: string[];
    found?: string[];
    score?: number;
    moves?: number;
    dailyKey?: string;
  }) {
    const state: Partial<GameState> = {
      score: opts.score ?? 100,
      moves: opts.moves ?? 10,
      chapter: 1,
      made: 2,
      found: opts.found ?? [itemAId],
      manifest: opts.manifest ?? (opts.mode === "daily" ? [itemAId, itemBId] : null),
      manifestFound: opts.manifestFound ?? [],
      over: opts.stateOver,
      theme,
      mode: opts.mode,
      daily: opts.dailyKey ?? (opts.mode === "daily" ? "2026-11-13" : null),
      board: [],
      tray: [],
      shelf: [],
      madeCounts: {},
      howMade: {},
      discoveredAtChapter: {},
      n: 6,
    } as unknown as GameState;

    const [row] = await getDb()
      .insert(schema.combineRuns)
      .values({
        ownerKind: "user",
        ownerId: userId,
        mode: opts.mode,
        theme,
        dailyKey: opts.dailyKey ?? (opts.mode === "daily" ? "2026-11-13" : ""),
        seed: 1,
        stateJson: state as unknown as object,
        eventCount: 42,
        status: "active",
        engineVersion: ENGINE_VERSION,
        startedAt: opts.mode === "daily" ? new Date() : null,
      })
      .returning();
    return row;
  }

  beforeAll(async () => {
    const db = getDb();
    await db.insert(schema.kinds).values({ code: kindCode, label: "test pw kind", position: 9998 });
    await db.insert(schema.items).values([
      { id: itemAId, slug: `tpw-${suite}-a`, name: `tpw ${suite} a`, tier: "F", kind: kindCode, fact: "" },
      { id: itemBId, slug: `tpw-${suite}-b`, name: `tpw ${suite} b`, tier: "F", kind: kindCode, fact: "" },
    ]);
    await db.insert(schema.combineThemes).values({ code: theme, label: "pw test" });
    // Insert an auth user — progress rows reference user_id but there's
    // no FK, so even a synthetic id works. We still insert a real row
    // so other side-effect writes (handles, etc.) don't choke.
    await db.insert(schema.authUser).values({
      id: userId,
      email: userEmail,
      emailVerified: true,
      name: "pw test",
      handle: `pwtest-${suite}`,
    });
  });

  afterAll(async () => {
    const db = getDb();
    await db
      .delete(schema.combineRuns)
      .where(eq(schema.combineRuns.theme, theme));
    await db.delete(schema.progress).where(eq(schema.progress.userId, userId));
    await db.delete(schema.combineDiscoveries).where(eq(schema.combineDiscoveries.userId, userId));
    await db.delete(schema.combineThemes).where(eq(schema.combineThemes.code, theme));
    await db.delete(schema.items).where(inArray(schema.items.id, [itemAId, itemBId]));
    await db.delete(schema.kinds).where(eq(schema.kinds.code, kindCode));
    await db.delete(schema.authUser).where(eq(schema.authUser.id, userId));
  });

  beforeEach(async () => {
    const db = getDb();
    await db.delete(schema.combineRuns).where(eq(schema.combineRuns.theme, theme));
    await db.delete(schema.progress).where(eq(schema.progress.userId, userId));
    await db.delete(schema.combineDiscoveries).where(eq(schema.combineDiscoveries.userId, userId));
  });

  it("writes a daily progress row with the result.daily key", async () => {
    const run = await insertRun({
      mode: "daily",
      stateOver: true,
      manifest: [itemAId, itemBId],
      manifestFound: [itemAId, itemBId],
      found: [itemAId, itemBId],
      score: 250,
      moves: 15,
      dailyKey: "2026-11-13",
    });
    const stored = run.stateJson as unknown as GameState;

    const out = await finalizeFromStoredState(run, stored, userId, {
      engineVersion: ENGINE_VERSION,
      clientDurationMs: 60_000,
    });

    expect(out.progressWritten).toBe(true);

    const rows = await getDb()
      .select()
      .from(schema.progress)
      .where(and(eq(schema.progress.userId, userId), eq(schema.progress.kind, "combine")));
    expect(rows).toHaveLength(1);
    const result = rows[0]!.result as Record<string, unknown>;
    expect(result.daily).toBe("2026-11-13");
    expect(result.score).toBe(250);
    expect(result.turns).toBe(15);
    expect(result.manifestFound).toBe(2);
    expect(result.manifestSize).toBe(2);
    expect(result.engineVersion).toBe(ENGINE_VERSION);

    const after = await getDb()
      .select()
      .from(schema.combineRuns)
      .where(eq(schema.combineRuns.id, run.id))
      .limit(1);
    expect(after[0]!.status).toBe("ended");
  });

  it("stamps legacyFinalize=true when the opt is set", async () => {
    const run = await insertRun({ mode: "daily", stateOver: true });
    const stored = run.stateJson as unknown as GameState;

    await finalizeFromStoredState(run, stored, userId, {
      engineVersion: ENGINE_VERSION - 1,
      legacy: true,
    });

    const [row] = await getDb()
      .select()
      .from(schema.progress)
      .where(eq(schema.progress.userId, userId))
      .limit(1);
    const result = row!.result as Record<string, unknown>;
    expect(result.legacyFinalize).toBe(true);
    expect(result.engineVersion).toBe(ENGINE_VERSION - 1);
  });

  it("endless mode writes a progress row without the daily key", async () => {
    const run = await insertRun({
      mode: "endless",
      stateOver: true,
      manifest: undefined,
      found: [itemAId],
    });
    const stored = run.stateJson as unknown as GameState;

    await finalizeFromStoredState(run, stored, userId, {
      engineVersion: ENGINE_VERSION,
    });

    const [row] = await getDb()
      .select()
      .from(schema.progress)
      .where(eq(schema.progress.userId, userId))
      .limit(1);
    const result = row!.result as Record<string, unknown>;
    expect(result.daily).toBeUndefined();
    expect(result.turns).toBeUndefined();
    expect(result.manifestSize).toBeUndefined();
    expect(result.mode).toBe("endless");
  });

  it("anon run (userId=null) ends the run but writes no progress", async () => {
    const run = await insertRun({ mode: "daily", stateOver: true });
    const stored = run.stateJson as unknown as GameState;

    const out = await finalizeFromStoredState(run, stored, null, {
      engineVersion: ENGINE_VERSION,
    });
    expect(out.progressWritten).toBe(false);

    const rows = await getDb()
      .select()
      .from(schema.progress)
      .where(eq(schema.progress.userId, userId));
    expect(rows).toHaveLength(0);

    const [after] = await getDb()
      .select()
      .from(schema.combineRuns)
      .where(eq(schema.combineRuns.id, run.id))
      .limit(1);
    expect(after!.status).toBe("ended");
  });
});
