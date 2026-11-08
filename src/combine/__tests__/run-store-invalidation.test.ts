import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  invalidateRunsForTheme,
  invalidateRunsForThemes,
  invalidateRunsForItems,
  invalidateAllActiveRuns,
} from "../run-store";
import { getDb, schema } from "@/db/client";

// Invalidation touches combine_runs (+ joins items/themes for the item
// variant) so the real tests need Postgres. Skip cleanly when no URL is
// configured — matches the pattern in theme-version.test.ts.
const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb("invalidateRuns* helpers (db)", () => {
  const suite = randomUUID().slice(0, 8);
  const themeA = `test-inv-a-${suite}`;
  const themeB = `test-inv-b-${suite}`;
  const themeC = `test-inv-c-${suite}`;
  const ownerPrefix = `test-owner-${suite}`;

  // Persistent items we attach to the test themes. We use a fresh kind so
  // test rows can't collide with real data, and we clean up in afterAll.
  const kindCode = `tinv-${suite}`;
  const item1Id = randomUUID();
  const item2Id = randomUUID();
  const item3Id = randomUUID();

  const minimalState = { tiles: [], score: 0 } as unknown as object;

  async function insertRun(opts: {
    ownerSuffix: string;
    mode: string;
    theme: string;
    status?: "active" | "ended" | "invalidated";
  }) {
    const [row] = await getDb()
      .insert(schema.combineRuns)
      .values({
        ownerKind: "anon",
        ownerId: `${ownerPrefix}-${opts.ownerSuffix}`,
        mode: opts.mode,
        theme: opts.theme,
        dailyKey: "",
        seed: 1,
        stateJson: minimalState,
        status: opts.status ?? "active",
      })
      .returning();
    return row;
  }

  async function readRun(id: string) {
    const [row] = await getDb()
      .select()
      .from(schema.combineRuns)
      .where(eq(schema.combineRuns.id, id))
      .limit(1);
    return row;
  }

  beforeAll(async () => {
    const db = getDb();
    await db.insert(schema.kinds).values({ code: kindCode, label: "test inv kind", position: 9999 });
    await db.insert(schema.items).values([
      { id: item1Id, slug: `tinv-${suite}-1`, name: `tinv ${suite} 1`, tier: "F", kind: kindCode, fact: "" },
      { id: item2Id, slug: `tinv-${suite}-2`, name: `tinv ${suite} 2`, tier: "F", kind: kindCode, fact: "" },
      { id: item3Id, slug: `tinv-${suite}-3`, name: `tinv ${suite} 3`, tier: "F", kind: kindCode, fact: "" },
    ]);
    await db.insert(schema.combineThemes).values([
      { code: themeA, label: "A" },
      { code: themeB, label: "B" },
      { code: themeC, label: "C" },
    ]);
    await db.insert(schema.itemCombineThemes).values([
      { itemId: item1Id, themeCode: themeA, source: "manual" },
      { itemId: item2Id, themeCode: themeB, source: "manual" },
      // item3 is not in any theme — it should produce no invalidations
    ]);
  });

  afterAll(async () => {
    const db = getDb();
    await db
      .delete(schema.combineRuns)
      .where(inArray(schema.combineRuns.theme, [themeA, themeB, themeC]));
    await db
      .delete(schema.itemCombineThemes)
      .where(inArray(schema.itemCombineThemes.themeCode, [themeA, themeB, themeC]));
    await db
      .delete(schema.combineThemes)
      .where(inArray(schema.combineThemes.code, [themeA, themeB, themeC]));
    await db
      .delete(schema.items)
      .where(inArray(schema.items.id, [item1Id, item2Id, item3Id]));
    await db.delete(schema.kinds).where(eq(schema.kinds.code, kindCode));
  });

  beforeEach(async () => {
    // Clear any runs left over from a prior test in this suite.
    await getDb()
      .delete(schema.combineRuns)
      .where(inArray(schema.combineRuns.theme, [themeA, themeB, themeC]));
  });

  it("invalidateRunsForTheme flips active runs and bumps epoch", async () => {
    const run = await insertRun({ ownerSuffix: "t1", mode: "endless", theme: themeA });
    const beforeEpoch = run.epoch;

    const n = await invalidateRunsForTheme(themeA);
    expect(n).toBe(1);

    const after = await readRun(run.id);
    expect(after?.status).toBe("invalidated");
    expect(after?.epoch).toBe(beforeEpoch + 1);
    expect(after?.endedAt).not.toBeNull();
  });

  it("invalidateRunsForTheme leaves runs on other themes alone", async () => {
    const onA = await insertRun({ ownerSuffix: "t2a", mode: "endless", theme: themeA });
    const onB = await insertRun({ ownerSuffix: "t2b", mode: "endless", theme: themeB });

    const n = await invalidateRunsForTheme(themeA);
    expect(n).toBe(1);

    expect((await readRun(onA.id))?.status).toBe("invalidated");
    expect((await readRun(onB.id))?.status).toBe("active");
  });

  it("invalidateRunsForTheme ignores non-active rows", async () => {
    const ended = await insertRun({
      ownerSuffix: "t3",
      mode: "endless",
      theme: themeA,
      status: "ended",
    });

    const n = await invalidateRunsForTheme(themeA);
    expect(n).toBe(0);

    const after = await readRun(ended.id);
    expect(after?.status).toBe("ended"); // unchanged
  });

  it("invalidateRunsForThemes handles empty list without touching the DB", async () => {
    await insertRun({ ownerSuffix: "t4", mode: "endless", theme: themeA });
    const n = await invalidateRunsForThemes([]);
    expect(n).toBe(0);
  });

  it("invalidateRunsForThemes covers every theme in one pass", async () => {
    const onA = await insertRun({ ownerSuffix: "t5a", mode: "endless", theme: themeA });
    const onB = await insertRun({ ownerSuffix: "t5b", mode: "endless", theme: themeB });
    const onC = await insertRun({ ownerSuffix: "t5c", mode: "endless", theme: themeC });

    const n = await invalidateRunsForThemes([themeA, themeB]);
    expect(n).toBe(2);

    expect((await readRun(onA.id))?.status).toBe("invalidated");
    expect((await readRun(onB.id))?.status).toBe("invalidated");
    expect((await readRun(onC.id))?.status).toBe("active");
  });

  it("invalidateRunsForItems maps items through itemCombineThemes", async () => {
    const onA = await insertRun({ ownerSuffix: "t6a", mode: "endless", theme: themeA });
    const onB = await insertRun({ ownerSuffix: "t6b", mode: "endless", theme: themeB });
    const onC = await insertRun({ ownerSuffix: "t6c", mode: "endless", theme: themeC });

    // item1 ∈ themeA, item2 ∈ themeB → both themes' runs get invalidated.
    const n = await invalidateRunsForItems([item1Id, item2Id]);
    expect(n).toBe(2);

    expect((await readRun(onA.id))?.status).toBe("invalidated");
    expect((await readRun(onB.id))?.status).toBe("invalidated");
    expect((await readRun(onC.id))?.status).toBe("active");
  });

  it("invalidateRunsForItems returns 0 for items with no theme membership", async () => {
    await insertRun({ ownerSuffix: "t7", mode: "endless", theme: themeC });
    const n = await invalidateRunsForItems([item3Id]);
    expect(n).toBe(0);
  });

  it("invalidateRunsForItems is a no-op on empty input", async () => {
    await insertRun({ ownerSuffix: "t8", mode: "endless", theme: themeA });
    const n = await invalidateRunsForItems([]);
    expect(n).toBe(0);
  });

  it("invalidateAllActiveRuns transitions every active row in the test themes", async () => {
    await insertRun({ ownerSuffix: "t9a", mode: "endless", theme: themeA });
    await insertRun({ ownerSuffix: "t9b", mode: "endless", theme: themeB });
    // An already-ended row should not be included in the count.
    const ended = await insertRun({
      ownerSuffix: "t9c",
      mode: "endless",
      theme: themeC,
      status: "ended",
    });

    const n = await invalidateAllActiveRuns();
    // Other suites might have left active rows; just assert ours were hit.
    expect(n).toBeGreaterThanOrEqual(2);

    // Our active ones are now invalidated; the already-ended one is untouched.
    const rows = await getDb()
      .select({ id: schema.combineRuns.id, status: schema.combineRuns.status })
      .from(schema.combineRuns)
      .where(
        and(
          inArray(schema.combineRuns.theme, [themeA, themeB]),
          eq(schema.combineRuns.status, "active"),
        ),
      );
    expect(rows).toHaveLength(0);
    expect((await readRun(ended.id))?.status).toBe("ended");
  });
});
