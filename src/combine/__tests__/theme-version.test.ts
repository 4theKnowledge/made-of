import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { validateCompletion, bumpCollectionVersion } from "../theme-version";
import { getDb, schema } from "@/db/client";
import { eq } from "drizzle-orm";

describe("validateCompletion", () => {
  it("accepts when version matches and every collectable is discovered", () => {
    const res = validateCompletion(["a", "b", "c"], ["a", "b", "c"], 3, 3);
    expect(res).toEqual({ ok: true, itemCount: 3 });
  });

  it("rejects when versions diverge", () => {
    const res = validateCompletion(["a"], ["a"], 1, 2);
    expect(res).toEqual({ ok: false, reason: "version_mismatch" });
  });

  it("rejects when any collectable is missing", () => {
    const res = validateCompletion(["a", "b", "c"], ["a", "b"], 5, 5);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("not_complete");
      expect(res.missing).toEqual(["c"]);
    }
  });

  it("treats version 0 as a valid state", () => {
    expect(validateCompletion([], [], 0, 0)).toEqual({ ok: true, itemCount: 0 });
  });

  it("works with Set inputs", () => {
    const res = validateCompletion(new Set(["a"]), new Set(["a", "extra"]), 1, 1);
    expect(res).toEqual({ ok: true, itemCount: 1 });
  });
});

// The bump helper touches Postgres, so skip the DB test when no URL is
// configured. Matches the pattern used elsewhere for optional DB tests.
const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb("bumpCollectionVersion (db)", () => {
  const code = `test-theme-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    await getDb()
      .insert(schema.combineThemes)
      .values({ code, label: "Test theme" });
  });

  afterAll(async () => {
    await getDb().delete(schema.combineThemes).where(eq(schema.combineThemes.code, code));
  });

  it("increments collection_version and returns the new value", async () => {
    const db = getDb();
    const v1 = await bumpCollectionVersion(db, code);
    expect(v1).toBe(1);
    const v2 = await bumpCollectionVersion(db, code);
    expect(v2).toBe(2);
    const [row] = await db
      .select({ v: schema.combineThemes.collectionVersion })
      .from(schema.combineThemes)
      .where(eq(schema.combineThemes.code, code));
    expect(row.v).toBe(2);
  });

  it("returns null for an unknown theme code", async () => {
    const v = await bumpCollectionVersion(getDb(), "does-not-exist-xyz");
    expect(v).toBeNull();
  });
});
