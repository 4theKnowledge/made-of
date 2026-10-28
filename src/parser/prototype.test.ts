import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLinkId, parsePrototype, parseYear, slug } from "./prototype";
import { countEvidencedLinkIds, toRows } from "./load";

const HTML = readFileSync(
  resolve(process.cwd(), "legacy/made-of.html"),
  "utf8",
);

describe("parsePrototype", () => {
  const parsed = parsePrototype(HTML);

  it("extracts 276 items from DATA", () => {
    expect(parsed.items).toHaveLength(276);
  });

  it("extracts 354 evidenced links from EVIDENCE", () => {
    expect(parsed.evidenceLinks).toHaveLength(354);
    // Each entry maps to one or more concrete link ids; the index of unique
    // ids is also 354 or more. We check both ways.
    expect(countEvidencedLinkIds(parsed.evidenceLinks)).toBeGreaterThanOrEqual(
      354,
    );
  });

  it("extracts 413 sources", () => {
    expect(parsed.sources).toHaveLength(413);
  });

  it("has no orphan references in DATA", () => {
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

  it("has no orphan references in EVIDENCE", () => {
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
  const parsed = parsePrototype(HTML);
  const rows = toRows(parsed);

  it("produces 276 item rows", () => {
    expect(rows.items).toHaveLength(276);
  });

  it("every parsed link slot becomes exactly one link row", () => {
    let total = 0;
    for (const it of parsed.items) {
      for (const r of it.recipes)
        total += r.f.length + r.w.length + r.n.length + r.e.length;
      total += it.itemLinks.n.length + it.itemLinks.s.length;
    }
    expect(rows.links).toHaveLength(total);
    expect(total).toBe(917);
  });

  it("evidence attaches to at least 354 distinct link rows", () => {
    const evidencedLinks = new Set(rows.linkEvidence.map((e) => e.linkId));
    expect(evidencedLinks.size).toBeGreaterThanOrEqual(354);
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
