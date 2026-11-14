import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getLatestStaleDailyRun } from "../run-store";
import { getDb, schema } from "@/db/client";

/**
 * Tests for `getLatestStaleDailyRun` — the helper the T-0333 prompt
 * relies on. The query is a `(ownerKind, ownerId, mode='daily',
 * status='active', dailyKey < today)` filter ordered by `updatedAt` desc.
 *
 * DB-gated: these need Postgres (the index enforces the one-active-per-slot
 * invariant so we can't fake it with an in-memory mock).
 */

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb("getLatestStaleDailyRun (db)", () => {
  const suite = randomUUID().slice(0, 8);
  const theme = `test-stale-${suite}`;
  const ownerId = `test-owner-stale-${suite}`;
  const minimalState = { score: 7, moves: 3 } as unknown as object;

  async function insertDailyRun(opts: {
    dailyKey: string;
    status?: "active" | "ended" | "invalidated";
    ownerKind?: "user" | "anon";
    customOwnerId?: string;
  }) {
    const [row] = await getDb()
      .insert(schema.combineRuns)
      .values({
        ownerKind: opts.ownerKind ?? "user",
        ownerId: opts.customOwnerId ?? ownerId,
        mode: "daily",
        theme,
        dailyKey: opts.dailyKey,
        seed: 1,
        stateJson: minimalState,
        status: opts.status ?? "active",
      })
      .returning();
    return row;
  }

  beforeAll(async () => {
    const db = getDb();
    await db.insert(schema.combineThemes).values({ code: theme, label: "T" });
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(schema.combineRuns).where(eq(schema.combineRuns.theme, theme));
    await db.delete(schema.combineThemes).where(eq(schema.combineThemes.code, theme));
  });

  beforeEach(async () => {
    await getDb().delete(schema.combineRuns).where(eq(schema.combineRuns.theme, theme));
  });

  it("returns an active daily run whose dailyKey is strictly before today", async () => {
    const yesterday = await insertDailyRun({ dailyKey: "2026-11-13" });
    const row = await getLatestStaleDailyRun(
      { kind: "user", id: ownerId },
      "2026-11-14",
    );
    expect(row?.id).toBe(yesterday.id);
  });

  it("returns null when the only run is on today's dailyKey", async () => {
    await insertDailyRun({ dailyKey: "2026-11-14" });
    const row = await getLatestStaleDailyRun(
      { kind: "user", id: ownerId },
      "2026-11-14",
    );
    expect(row).toBeNull();
  });

  it("returns null when the prior-day run is already ended", async () => {
    await insertDailyRun({ dailyKey: "2026-11-13", status: "ended" });
    const row = await getLatestStaleDailyRun(
      { kind: "user", id: ownerId },
      "2026-11-14",
    );
    expect(row).toBeNull();
  });

  it("returns null when the prior-day run is invalidated", async () => {
    await insertDailyRun({ dailyKey: "2026-11-13", status: "invalidated" });
    const row = await getLatestStaleDailyRun(
      { kind: "user", id: ownerId },
      "2026-11-14",
    );
    expect(row).toBeNull();
  });

  it("returns the newest when multiple prior-day actives exist", async () => {
    await insertDailyRun({ dailyKey: "2026-11-10" });
    // Sleep briefly so updatedAt differs; drizzle's default is now() per
    // row insert so insert-order matches updatedAt-order in practice.
    const newer = await insertDailyRun({ dailyKey: "2026-11-12" });
    const row = await getLatestStaleDailyRun(
      { kind: "user", id: ownerId },
      "2026-11-14",
    );
    expect(row?.id).toBe(newer.id);
  });

  it("scopes to the requested owner", async () => {
    const otherOwner = `${ownerId}-other`;
    await insertDailyRun({
      dailyKey: "2026-11-13",
      customOwnerId: otherOwner,
    });
    const row = await getLatestStaleDailyRun(
      { kind: "user", id: ownerId },
      "2026-11-14",
    );
    expect(row).toBeNull();
    // Cleanup
    await getDb()
      .delete(schema.combineRuns)
      .where(inArray(schema.combineRuns.ownerId, [otherOwner]));
  });

  it("scopes to the requested ownerKind (anon vs user)", async () => {
    await insertDailyRun({ dailyKey: "2026-11-13", ownerKind: "anon" });
    const row = await getLatestStaleDailyRun(
      { kind: "user", id: ownerId },
      "2026-11-14",
    );
    expect(row).toBeNull();
  });

  it("includes stale-engine rows (recovery is still valid on bump)", async () => {
    const [row] = await getDb()
      .insert(schema.combineRuns)
      .values({
        ownerKind: "user",
        ownerId,
        mode: "daily",
        theme,
        dailyKey: "2026-11-13",
        seed: 1,
        stateJson: minimalState,
        status: "active",
        engineVersion: 1,
      })
      .returning();
    const got = await getLatestStaleDailyRun(
      { kind: "user", id: ownerId },
      "2026-11-14",
    );
    expect(got?.id).toBe(row.id);
  });

  it("does not return endless runs (mode scope)", async () => {
    await getDb().insert(schema.combineRuns).values({
      ownerKind: "user",
      ownerId,
      mode: "endless",
      theme,
      dailyKey: "",
      seed: 1,
      stateJson: minimalState,
      status: "active",
    });
    const row = await getLatestStaleDailyRun(
      { kind: "user", id: ownerId },
      "2026-11-14",
    );
    expect(row).toBeNull();
  });
});
