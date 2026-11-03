import { describe, expect, it } from "vitest";
import {
  loadKnowledgeBase,
  normaliseItem,
  parseLinkId,
  parseYear,
  slug,
} from "./load";
import { countEvidencedLinkIds, itemIdForSlug, toRows } from "./rows";

/** Items that are not physical things you could hold. These are not stored
 *  in the knowledge base at all — this test guards against anyone adding
 *  one back by hand. */
const NONPHYSICAL = new Set([
  "sunlight",
  "lightning",
  "electricity",
  "internet",
  "fire",
]);

describe("knowledge base", () => {
  const parsed = loadKnowledgeBase();

  it("has at least the original item count", () => {
    expect(parsed.items.length).toBeGreaterThanOrEqual(276);
  });

  it("contains no non-physical items", () => {
    for (const it of parsed.items) {
      expect(NONPHYSICAL.has(it.name)).toBe(false);
    }
  });

  it("contains no mentions of non-physical items in recipes or links", () => {
    const offences: string[] = [];
    for (const it of parsed.items) {
      const check = (where: string, arr: string[]) => {
        for (const n of arr)
          if (NONPHYSICAL.has(n)) offences.push(`${it.name}.${where} -> ${n}`);
      };
      for (const r of it.recipes) {
        check("recipe.f", r.f);
        check("recipe.w", r.w);
        check("recipe.n", r.n);
        check("recipe.e", r.e);
      }
      check("itemLinks.n", it.itemLinks.n);
      check("itemLinks.s", it.itemLinks.s);
    }
    expect(offences).toEqual([]);
  });

  it("has evidence link records", () => {
    expect(parsed.evidenceLinks.length).toBeGreaterThan(300);
    expect(countEvidencedLinkIds(parsed.evidenceLinks)).toBeGreaterThan(300);
  });

  it("has 413 sources", () => {
    expect(parsed.sources).toHaveLength(413);
  });

  it("has no orphan references in items", () => {
    const names = new Set(parsed.items.map((i) => i.name));
    const dangling: string[] = [];
    for (const it of parsed.items) {
      const check = (arr: string[]) => {
        for (const n of arr) if (!names.has(n)) dangling.push(`${it.name}->${n}`);
      };
      for (const r of it.recipes) {
        check(r.f);
        check(r.w);
        check(r.n);
        check(r.e);
      }
      check(it.itemLinks.n);
      check(it.itemLinks.s);
    }
    expect(dangling).toEqual([]);
  });

  it("has no orphan references in evidence", () => {
    const names = new Set(parsed.items.map((i) => i.name));
    const dangling: string[] = [];
    for (const l of parsed.evidenceLinks) {
      for (const id of l.ids) {
        const { childName, parentName } = parseLinkId(id);
        if (!names.has(childName)) dangling.push(`child missing: ${id}`);
        if (!names.has(parentName)) dangling.push(`parent missing: ${id}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("every evidence source id exists in sources", () => {
    const srcIds = new Set(parsed.sources.map((s) => s.id));
    const missing = new Set<string>();
    for (const l of parsed.evidenceLinks) {
      for (const e of l.evidence) {
        for (const sid of e.sources) if (!srcIds.has(sid)) missing.add(sid);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("confidences only use the four allowed values", () => {
    const allowed = new Set(["established", "strong", "debated", "hypothesis"]);
    for (const l of parsed.evidenceLinks) {
      expect(allowed.has(l.confidence)).toBe(true);
    }
  });

  it("recipe labels: either every alternative is labelled or there is only one recipe", () => {
    for (const it of parsed.items) {
      if (it.recipes.length <= 1) {
        if (it.recipes.length === 1) {
          expect(it.recipes[0].label).toBeNull();
        }
      }
    }
  });
});

describe("parseYear", () => {
  it("handles bya, mya, ka, year CE and BCE, with ~ prefix", () => {
    expect(parseYear("13.8bya")?.ya).toBe(13_800_000_000);
    expect(parseYear("385mya")?.ya).toBe(385_000_000);
    expect(parseYear("10ka")?.ya).toBe(10_000);
    expect(parseYear("1994")?.ya).toBe(32);
    expect(parseYear("-3500")?.ya).toBe(5526);
    expect(parseYear("?")).toBeNull();
    expect(parseYear("")).toBeNull();
    expect(parseYear(null)).toBeNull();
    const circa = parseYear("~4.4bya");
    expect(circa?.ya).toBe(4_400_000_000);
    expect(circa?.label.startsWith("About ")).toBe(true);
  });
});

describe("slug", () => {
  it("hyphenates spaces and strips punctuation", () => {
    expect(slug("big bang")).toBe("big-bang");
    expect(slug("CO2 laser")).toBe("co2-laser");
    expect(slug("hot spring pool")).toBe("hot-spring-pool");
  });
});

describe("toRows", () => {
  const parsed = loadKnowledgeBase();
  const rows = toRows(parsed);

  it("produces one row per parsed item", () => {
    expect(rows.items).toHaveLength(parsed.items.length);
  });

  it("every parsed link slot becomes exactly one link row", () => {
    let total = 0;
    for (const it of parsed.items) {
      for (const r of it.recipes)
        total += r.f.length + r.w.length + r.n.length + r.e.length;
      total += it.itemLinks.n.length + it.itemLinks.s.length;
    }
    expect(rows.links).toHaveLength(total);
  });

  it("evidence attaches to many distinct link rows", () => {
    const evidencedLinks = new Set(rows.linkEvidence.map((e) => e.linkId));
    expect(evidencedLinks.size).toBeGreaterThan(300);
  });

  it("every evidence_source references a known source", () => {
    const srcIds = new Set(rows.sources.map((s) => s.id));
    const dangling = rows.evidenceSources.filter(
      (es) => !srcIds.has(es.sourceId),
    );
    expect(dangling).toEqual([]);
  });

  it("every link row carries a confidence from the allowed set", () => {
    const allowed = new Set(["established", "strong", "debated", "hypothesis"]);
    for (const l of rows.links) expect(allowed.has(l.confidence!)).toBe(true);
  });

  it("exactly one of recipe_id or item_id is set on each link", () => {
    for (const l of rows.links) {
      const r = l.recipeId != null;
      const i = l.itemId != null;
      expect(r !== i).toBe(true);
    }
  });

  it("evidence has no unresolved ids", () => {
    expect(rows.stats.unresolvedEvidenceIds).toEqual([]);
  });
});

/** Regression: item ids must be stable across reseeds. If they drift,
 *  a reseed cascades through `combine_discoveries.itemId` (ON DELETE
 *  CASCADE) and wipes every user's Combine collection. See
 *  src/data/rows.ts for the UUIDv5-from-slug derivation. */
describe("item id stability", () => {
  const parsed = loadKnowledgeBase();

  it("produces the same item ids on repeated runs", () => {
    const first = toRows(parsed);
    const second = toRows(parsed);
    expect(first.items.length).toBe(second.items.length);
    const firstBySlug = new Map(first.items.map((it) => [it.slug, it.id]));
    for (const it of second.items) {
      expect(it.id).toBe(firstBySlug.get(it.slug));
    }
  });

  it("derives ids from slug via itemIdForSlug", () => {
    const rows = toRows(parsed);
    for (const it of rows.items) {
      expect(it.id).toBe(itemIdForSlug(it.slug));
    }
  });

  it("pinned slug survives a rename end-to-end", () => {
    // DataItem.slug is the identity anchor. Pinning it lets admins rename
    // an item without changing its UUIDv5 (and cascading away any
    // discoveries attached to the old row).
    const before = normaliseItem({
      name: "hydrogen",
      tier: "F",
      kind: "element",
    });
    const afterRename = normaliseItem({
      name: "hydrogen gas",
      slug: "hydrogen",
      tier: "F",
      kind: "element",
    });
    expect(before.slug).toBe("hydrogen");
    expect(afterRename.slug).toBe("hydrogen");
    expect(itemIdForSlug(afterRename.slug)).toBe(itemIdForSlug(before.slug));
  });

  it("omitting slug still derives it from name", () => {
    const n = normaliseItem({
      name: "liquid water",
      tier: "F",
      kind: "substance",
    });
    expect(n.slug).toBe("liquid-water");
  });

  it("itemIdForSlug returns a well-formed UUIDv5", () => {
    const id = itemIdForSlug("hydrogen");
    // RFC 4122: xxxxxxxx-xxxx-5xxx-[89ab]xxx-xxxxxxxxxxxx
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(itemIdForSlug("hydrogen")).toBe(id);
  });
});
