/**
 * Export the DB back to the hand-edited `Data*` shapes used by
 * `src/data/*.data.ts`. The output is the exchange format agents consume:
 * same shape as the source files, trivially re-importable.
 *
 * Format:
 *   {
 *     items: DataItem[],
 *     evidenceLinks: DataEvidenceLink[],
 *     sources: Record<string, DataSource>,
 *   }
 */

import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type {
  DataEvidenceEntry,
  DataEvidenceLink,
  DataItem,
  DataRecipe,
  DataSource,
  Tag,
} from "@/data/types";

export interface AdminExport {
  items: DataItem[];
  evidenceLinks: DataEvidenceLink[];
  sources: Record<string, DataSource>;
}

export async function exportAll(): Promise<AdminExport> {
  const db = getDb();
  const [items, recipes, links, evidence, evSources, sources] = await Promise.all([
    db.select().from(schema.items).orderBy(asc(schema.items.slug)),
    db.select().from(schema.recipes).orderBy(asc(schema.recipes.itemId), asc(schema.recipes.position)),
    db.select().from(schema.links),
    db.select().from(schema.linkEvidence).orderBy(asc(schema.linkEvidence.linkId), asc(schema.linkEvidence.position)),
    db.select().from(schema.evidenceSources).orderBy(asc(schema.evidenceSources.evidenceId), asc(schema.evidenceSources.position)),
    db.select().from(schema.sources).orderBy(asc(schema.sources.code)),
  ]);

  // Index items by id so we can resolve targetItemId -> name for the Data* shape.
  const itemById = new Map(items.map((i) => [i.id, i]));

  // Group recipes by itemId, group links by (recipeId | itemId).
  const recipesByItem = new Map<string, typeof recipes>();
  for (const r of recipes) {
    const arr = recipesByItem.get(r.itemId) ?? [];
    arr.push(r);
    recipesByItem.set(r.itemId, arr);
  }

  const linksByRecipe = new Map<string, typeof links>();
  const linksByItem = new Map<string, typeof links>();
  for (const l of links) {
    if (l.recipeId) {
      const arr = linksByRecipe.get(l.recipeId) ?? [];
      arr.push(l);
      linksByRecipe.set(l.recipeId, arr);
    } else if (l.itemId) {
      const arr = linksByItem.get(l.itemId) ?? [];
      arr.push(l);
      linksByItem.set(l.itemId, arr);
    }
  }

  // Rebuild DataItems. We skip canary links (they aren't in source data —
  // the seeder plants them separately).
  const dataItems: DataItem[] = items.map((i) => {
    const itemRecipes = (recipesByItem.get(i.id) ?? [])
      .sort((a, b) => a.position - b.position)
      .map<DataRecipe>((r) => {
        const rLinks = (linksByRecipe.get(r.id) ?? []).filter((l) => !l.isCanary);
        const by = (t: string) =>
          rLinks
            .filter((l) => l.type === t)
            .map((l) => itemById.get(l.targetItemId)?.name ?? l.targetItemId);
        const recipe: DataRecipe = {};
        if (r.label != null) recipe.label = r.label;
        const f = by("f");
        const w = by("w");
        const n = by("n");
        const e = by("e");
        if (f.length) recipe.f = f;
        if (w.length) recipe.w = w;
        if (n.length) recipe.n = n;
        if (e.length) recipe.e = e;
        return recipe;
      });

    const iLinks = (linksByItem.get(i.id) ?? []).filter((l) => !l.isCanary);
    const linksN = iLinks.filter((l) => l.type === "n").map((l) => itemById.get(l.targetItemId)?.name ?? l.targetItemId);
    const linksS = iLinks.filter((l) => l.type === "s").map((l) => itemById.get(l.targetItemId)?.name ?? l.targetItemId);

    const d: DataItem = {
      name: i.name,
      tier: i.tier,
      kind: i.kind,
    };
    if (i.firstAppeared) d.firstAppeared = i.firstAppeared;
    if (i.symbol) d.symbol = i.symbol;
    if (i.fact) d.fact = i.fact;
    if (itemRecipes.length) d.recipes = itemRecipes;
    if (linksN.length) d.linksN = linksN;
    if (linksS.length) d.linksS = linksS;
    if (i.tags.length) d.tags = i.tags as Tag[];
    return d;
  });

  // Rebuild evidence links. Group evidence rows by the artifact-shape id
  // (`child<type<parent`). Evidence for canary links is skipped.
  const evSourcesByEvidence = new Map<string, Array<{ sourceId: string; position: number }>>();
  for (const es of evSources) {
    const arr = evSourcesByEvidence.get(es.evidenceId) ?? [];
    arr.push(es);
    evSourcesByEvidence.set(es.evidenceId, arr);
  }

  // link.id -> artifact key (`child<type<parent`), confidence, note.
  const linkKey = (l: (typeof links)[number]) => {
    const target = itemById.get(l.targetItemId)?.name ?? l.targetItemId;
    let parent = "";
    if (l.recipeId) {
      const r = recipes.find((rr) => rr.id === l.recipeId);
      if (r) parent = itemById.get(r.itemId)?.name ?? r.itemId;
    } else if (l.itemId) {
      parent = itemById.get(l.itemId)?.name ?? l.itemId;
    }
    // Artifact format is `child<type<parent`, where child is the thing-being-made's
    // input/need (= target) and parent is the thing being made (= item/recipe owner).
    // Actually the convention in src/data: `RNA<f<nucleotides` means RNA made from
    // nucleotides, so child=RNA (parent-item), parent=nucleotides (target). We
    // follow that: child = item.name, parent = target.name.
    return `${parent === "" ? "?" : parent}<${l.type}<${target}`;
  };

  // Collect (artifact key, confidence, note) tuples with evidence attached.
  const linksEligible = links.filter((l) => !l.isCanary);
  // Group by (key, confidence, note) so multiple matching link rows reuse
  // one evidenceLink entry — matches the source-file convention.
  type EvBucket = {
    ids: Set<string>;
    confidence: string;
    note: string;
    evidenceByLinkId: Map<string, typeof evidence>;
  };
  const buckets = new Map<string, EvBucket>();
  const evidenceByLinkId = new Map<string, typeof evidence>();
  for (const e of evidence) {
    const arr = evidenceByLinkId.get(e.linkId) ?? [];
    arr.push(e);
    evidenceByLinkId.set(e.linkId, arr);
  }

  for (const l of linksEligible) {
    const lEv = evidenceByLinkId.get(l.id) ?? [];
    if (lEv.length === 0 && l.confidence === "established" && !l.note) continue;
    const key = `${l.confidence}|${l.note ?? ""}`;
    const b = buckets.get(key) ?? {
      ids: new Set<string>(),
      confidence: l.confidence,
      note: l.note ?? "",
      evidenceByLinkId: new Map(),
    };
    b.ids.add(linkKey(l));
    if (lEv.length) b.evidenceByLinkId.set(l.id, lEv);
    buckets.set(key, b);
  }

  const sourceCodeById = new Map(sources.map((s) => [s.id, s.code]));
  const dataEvidenceLinks: DataEvidenceLink[] = [];
  for (const b of buckets.values()) {
    // Pick one representative set of evidence entries (they should be
    // identical across links sharing the same artifact-shape key, since
    // seed.ts duplicates each entry per matching link). We dedupe by
    // (type, stance, summary).
    const seen = new Set<string>();
    const entries: DataEvidenceEntry[] = [];
    for (const [, lEv] of b.evidenceByLinkId) {
      for (const e of lEv) {
        const k = `${e.type}|${e.stance}|${e.summary}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const srcs = (evSourcesByEvidence.get(e.id) ?? [])
          .sort((a, z) => a.position - z.position)
          .map((s) => sourceCodeById.get(s.sourceId) ?? s.sourceId);
        entries.push({
          type: e.type,
          stance: e.stance,
          summary: e.summary,
          ...(srcs.length ? { sources: srcs } : {}),
        });
      }
    }
    const link: DataEvidenceLink = {
      ids: [...b.ids].sort(),
      confidence: b.confidence as DataEvidenceLink["confidence"],
      ...(b.note ? { note: b.note } : {}),
      ...(entries.length ? { evidence: entries } : {}),
    };
    dataEvidenceLinks.push(link);
  }

  // Only include sources that are actually referenced.
  const usedSourceIds = new Set<string>();
  for (const es of evSources) usedSourceIds.add(es.sourceId);
  const sourceMap: Record<string, DataSource> = {};
  for (const s of sources) {
    if (!usedSourceIds.has(s.id)) continue;
    const d: DataSource = { kind: s.kind, title: s.title };
    if (s.authors) d.authors = s.authors;
    if (s.year != null) d.year = s.year;
    if (s.published) d.published = s.published;
    if (s.url) d.url = s.url;
    sourceMap[s.code] = d;
  }
  return { items: dataItems, evidenceLinks: dataEvidenceLinks, sources: sourceMap };
}
