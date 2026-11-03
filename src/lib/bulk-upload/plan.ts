/**
 * Build a Plan from a pack + KB projection.
 *
 * The planner is pure (no DB access) — a caller gathers the KbIndex once and
 * feeds it in. It classifies every item, every source, and every evidence
 * reference, applies sensible default decisions, and returns a Plan the
 * admin can tweak in the UI before confirming apply.
 */

import { slug as toSlug } from "@/data/load";
import { normaliseKey, validateIntraPack, validateSchema } from "./validate";
import type {
  BulkPack,
  ItemDecision,
  ItemDisposition,
  ItemPlanEntry,
  KbIndex,
  Plan,
  SourcePlanEntry,
} from "./types";

export function buildPlan(pack: BulkPack, kb: KbIndex): Plan {
  // 1. Schema validation. Drop entries that fail hard checks so later
  //    passes don't crash on malformed input.
  const schema = validateSchema(pack, kb);
  const workingPack: BulkPack = {
    items: schema.validItems,
    evidenceLinks: schema.validEvidenceLinks,
    sources: schema.validSources,
  };

  // 2. Intra-pack checks (duplicate names, unresolved references).
  const intraIssues = validateIntraPack(workingPack, kb);

  // 3. Classify items against the DB.
  const items: ItemPlanEntry[] = [];
  // Normalised-key index of DB items, built once, used for fuzzy matching.
  const kbByNormalised = new Map<string, { id: string; name: string }>();
  for (const [name, item] of kb.itemByName) {
    kbByNormalised.set(normaliseKey(name), { id: item.id, name });
  }

  for (const it of workingPack.items) {
    const packSlug = toSlug(it.name);
    const nameMatch = kb.itemByName.get(it.name);
    const slugMatch = kb.itemBySlug.get(packSlug);
    const normalised = normaliseKey(it.name);
    const fuzzyMatch = kbByNormalised.get(normalised);

    let disposition: ItemDisposition;
    let decision: ItemDecision;

    if (nameMatch) {
      disposition = { kind: "name_collision", existingItemId: nameMatch.id };
      decision = "merge";
    } else if (slugMatch && slugMatch.name !== it.name) {
      // Different name, same slug — this is almost always a mistake and
      // can't be inserted as-is (slug is a unique column). Default to
      // skip; admin can flip to merge if they recognise it.
      disposition = {
        kind: "slug_collision",
        existingItemId: slugMatch.id,
        existingName: slugMatch.name,
      };
      decision = "skip";
    } else if (fuzzyMatch && fuzzyMatch.name !== it.name) {
      disposition = {
        kind: "fuzzy_match",
        existingItemId: fuzzyMatch.id,
        existingName: fuzzyMatch.name,
        normalisedKey: normalised,
      };
      decision = "insert";
    } else {
      disposition = { kind: "new" };
      decision = "insert";
    }

    items.push({ name: it.name, slug: packSlug, disposition, decision });
  }

  // 4. Classify sources.
  const sources: SourcePlanEntry[] = Object.keys(workingPack.sources).map(
    (code) => ({
      code,
      disposition: kb.existingSourceCodes.has(code) ? "exists" : "new",
    }),
  );

  // 5. Rough counts of what will be inserted. These re-count after each
  //    decision change in the UI, so they are intentionally cheap.
  const insertedNames = new Set<string>();
  for (const entry of items) {
    if (entry.decision === "insert") insertedNames.add(entry.name);
  }

  let linkCount = 0;
  for (const it of workingPack.items) {
    const entry = items.find((e) => e.name === it.name);
    if (!entry) continue;
    if (entry.decision === "skip") continue;
    // Both `insert` and `merge` add the recipes/links on the pack item.
    for (const r of it.recipes ?? []) {
      linkCount += (r.f?.length ?? 0) + (r.w?.length ?? 0) + (r.n?.length ?? 0) + (r.e?.length ?? 0);
    }
    linkCount += (it.linksN?.length ?? 0) + (it.linksS?.length ?? 0);
  }

  let evidenceCount = 0;
  for (const ev of workingPack.evidenceLinks) {
    evidenceCount += (ev.evidence?.length ?? 0) * ev.ids.length;
  }

  return {
    items,
    sources,
    evidenceCount,
    linkCount,
    issues: [...schema.issues, ...intraIssues],
  };
}
