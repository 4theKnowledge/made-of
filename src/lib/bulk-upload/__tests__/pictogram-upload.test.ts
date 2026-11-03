/**
 * Tests the DB-free pieces of pictogram-upload: input normalisation and the
 * sanitiser interaction. The full planner needs a DB and is exercised
 * through the API handler in dev.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PictogramPayload } from "../pictogram-upload";

// Mock the DB client the planner reaches for.
vi.mock("@/db/client", () => {
  return {
    getDb: () => ({
      select: () => ({
        from: () => ({
          then: (resolve: (v: unknown) => unknown) => resolve([]),
          // Also support awaiting the promise form the real client returns.
          [Symbol.asyncIterator]: undefined,
        }),
      }),
    }),
    schema: {
      items: { id: "id", name: "name", pictogram: "pictogram" },
      kinds: { code: "code", pictogram: "pictogram" },
    },
  };
});

// Rebuild a Promise-shaped mock so Drizzle's `await db.select().from(...)` resolves.
beforeEach(async () => {
  const client = await import("@/db/client");
  (client.getDb as unknown as () => unknown) = () => ({
    select: () => ({
      from: () => Promise.resolve([]),
    }),
  });
});

describe("pictogram-upload normalisation", () => {
  it("accepts a flat dict", async () => {
    const { planPictogramUpload } = await import("../pictogram-upload");
    const payload: PictogramPayload = {
      iron: '<circle class="b" cx="16" cy="16" r="6"/>',
    };
    const plan = await planPictogramUpload(payload);
    // With no DB rows, iron resolves to orphan.
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].disposition.kind).toBe("orphan");
  });

  it("strips keys starting with underscore (e.g. _readme from the template)", async () => {
    const { planPictogramUpload } = await import("../pictogram-upload");
    const payload: PictogramPayload = {
      _readme: "ignored",
      iron: '<circle class="b" cx="16" cy="16" r="6"/>',
    } as PictogramPayload;
    const plan = await planPictogramUpload(payload);
    expect(plan.entries.map((e) => e.sourceKey)).toEqual(["iron"]);
  });

  it("flags invalid SVG with sanitiser errors", async () => {
    const { planPictogramUpload } = await import("../pictogram-upload");
    const plan = await planPictogramUpload({
      bad: "<script>alert(1)</script>",
    });
    expect(plan.entries[0].disposition.kind).toBe("invalid_svg");
  });

  it("accepts the explicit {items, kinds} form", async () => {
    const { planPictogramUpload } = await import("../pictogram-upload");
    const plan = await planPictogramUpload({
      items: { iron: '<circle class="b" cx="1" cy="1" r="1"/>' },
      kinds: { mineral: '<circle class="b" cx="1" cy="1" r="1"/>' },
    });
    expect(plan.entries).toHaveLength(2);
    // Both resolve to orphan without DB rows, but the shape was accepted.
    expect(plan.entries.every((e) => e.disposition.kind === "orphan")).toBe(true);
  });
});
