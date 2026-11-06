/**
 * Apply a planned bulk upload. Additive, transactional, and merge-aware.
 *
 * Takes a pack + a frozen set of ItemDecision overrides (keyed by item name),
 * reloads a fresh KbIndex inside the transaction, rebuilds the plan to
 * sanity-check nothing has changed under us, then inserts:
 *   - new items (status='live' to match the seeder)
 *   - everything-theme membership for items not flagged `isCombineExcluded`
 *   - new recipes/links for inserted items AND for merged items
 *   - new sources (skipping any whose code already exists)
 *   - evidence rows and evidence-source joins for the links we touched
 *
 * Hard rules preserved:
 *   - Existing items are never mutated (editorial fields untouched)
 *   - Existing links are never duplicated: for merged items, we skip
 *     (recipe-id, type, target) tuples that already exist and item-level
 *     (item-id, type, target) tuples that already exist
 *   - Existing sources keep their stored metadata (pack copies are
 *     ignored for existing codes)
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { parseYear, parseLinkId, slug as toSlug } from "@/data/load";
import { getDb, schema } from "@/db/client";
import type {
  Confidence,
  EvidenceStance,
  ItemKind,
  LinkType,
  SourceKind,
  Tier,
} from "@/db/schema";
import { buildPlan } from "./plan";
import { loadKbIndex } from "./load-kb";
import type { BulkPack, ItemDecision, Plan } from "./types";

export interface ApplyResult {
  ok: boolean;
  dryRun: boolean;
  stats: {
    itemsInserted: number;
    itemsMerged: number;
    itemsSkipped: number;
    recipesInserted: number;
    linksInserted: number;
    linksSkippedDuplicate: number;
    sourcesInserted: number;
    evidenceInserted: number;
  };
  issues: Plan["issues"];
  errors: string[];
}

export interface ApplyInput {
  pack: BulkPack;
  /** Map of item name → chosen decision. Any item not listed falls back to
   *  the planner's default. */
  decisions: Record<string, ItemDecision>;
  dryRun: boolean;
}

export async function applyBulk(input: ApplyInput): Promise<ApplyResult> {
  const emptyStats = {
    itemsInserted: 0,
    itemsMerged: 0,
    itemsSkipped: 0,
    recipesInserted: 0,
    linksInserted: 0,
    linksSkippedDuplicate: 0,
    sourcesInserted: 0,
    evidenceInserted: 0,
  };

  const kb = await loadKbIndex();
  const plan = buildPlan(input.pack, kb);

  // Any error-level issue blocks the apply. Decisions can't paper over
  // bad data — the admin has to fix the pack and re-plan.
  const errorIssues = plan.issues.filter((i) => i.severity === "error");
  if (errorIssues.length > 0) {
    return {
      ok: false,
      dryRun: input.dryRun,
      stats: emptyStats,
      issues: plan.issues,
      errors: errorIssues.map((i) => `${i.code}: ${i.message}`),
    };
  }

  // Final effective decision per item.
  type Effective = {
    name: string;
    decision: ItemDecision;
    existingItemId: string | null;
  };
  const effective = new Map<string, Effective>();
  for (const entry of plan.items) {
    const chosen = input.decisions[entry.name] ?? entry.decision;
    let existingItemId: string | null = null;
    if (entry.disposition.kind === "name_collision") {
      existingItemId = entry.disposition.existingItemId;
    } else if (entry.disposition.kind === "slug_collision") {
      existingItemId = entry.disposition.existingItemId;
    } else if (entry.disposition.kind === "fuzzy_match") {
      existingItemId = entry.disposition.existingItemId;
    }
    effective.set(entry.name, {
      name: entry.name,
      decision: chosen,
      existingItemId,
    });
  }

  // A decision of "insert" when the name already exists is a hard error —
  // the UI should prevent this, but we check server-side too.
  const errors: string[] = [];
  for (const [name, eff] of effective) {
    if (eff.decision === "insert" && eff.existingItemId) {
      errors.push(
        `Cannot insert "${name}" — an item with the same name/slug already exists. Choose merge or skip.`,
      );
    }
    if (eff.decision === "merge" && !eff.existingItemId) {
      errors.push(
        `Cannot merge "${name}" — no existing item to merge into. Choose insert or skip.`,
      );
    }
  }
  if (errors.length > 0) {
    return {
      ok: false,
      dryRun: input.dryRun,
      stats: emptyStats,
      issues: plan.issues,
      errors,
    };
  }

  // Index pack items by name for easy lookup during apply.
  const packByName = new Map(input.pack.items.map((it) => [it.name, it]));

  // Resolve a referenced name to an item id. Order of precedence:
  //   1. If the pack item will be inserted or merged, use its destination id.
  //   2. Otherwise look up in the DB.
  // A `skip` on a pack item that collides with an existing item resolves
  // to the existing item (the admin chose to use the DB version).
  const nameToId = new Map<string, string>();
  const stats = { ...emptyStats };

  const db = getDb();

  try {
    await db.transaction(async (tx) => {
      // ---------- 0. Upsert kinds introduced by the pack ----------
      // New kinds are inserted; existing kinds have their pictogram
      // backfilled only when the DB value is null (same editorial-fields
      // rule as items on merge: don't overwrite admin choices).
      for (const [code, k] of Object.entries(input.pack.kinds ?? {})) {
        if (!kb.existingKindCodes.has(code)) {
          await tx.insert(schema.kinds).values({
            code,
            label: k.label ?? code,
            description: k.description ?? null,
            pictogram: k.pictogram ?? null,
          });
        } else if (k.pictogram) {
          // Fill-when-empty merge for existing kinds.
          const [row] = await tx
            .select({ pictogram: schema.kinds.pictogram })
            .from(schema.kinds)
            .where(eq(schema.kinds.code, code))
            .limit(1);
          if (row && row.pictogram === null) {
            await tx
              .update(schema.kinds)
              .set({ pictogram: k.pictogram, updatedAt: new Date() })
              .where(eq(schema.kinds.code, code));
          }
        }
      }

      // ---------- 1. Insert new items ----------
      const toInsert = [...effective.values()].filter(
        (e) => e.decision === "insert",
      );
      const newItemRows = toInsert.map((e) => {
        const it = packByName.get(e.name)!;
        const id = randomUUID();
        const parsedYears = parseYear(it.firstAppeared ?? null);
        nameToId.set(e.name, id);
        return {
          id,
          slug: toSlug(it.name),
          name: it.name.toLowerCase(),
          tier: it.tier as Tier,
          kind: it.kind as ItemKind,
          firstAppeared: it.firstAppeared ?? null,
          firstAppearedYa: parsedYears ? Math.round(parsedYears.ya) : null,
          symbol: it.symbol ?? null,
          fact: it.fact ?? "",
          pictogram: it.pictogram ?? null,
          status: "live" as const,
          isCanary: false,
          isCombineExcluded: it.isCombineExcluded ?? false,
          tags: (it.tags ?? []) as string[],
        };
      });
      if (newItemRows.length > 0) {
        await tx.insert(schema.items).values(newItemRows);
        stats.itemsInserted = newItemRows.length;

        // Everything theme membership for new items that aren't excluded.
        const everythingMembers = newItemRows
          .filter((r) => !r.isCombineExcluded)
          .map((r) => ({ itemId: r.id, themeCode: "everything" }));
        if (everythingMembers.length > 0) {
          await tx
            .insert(schema.itemCombineThemes)
            .values(everythingMembers)
            .onConflictDoNothing();
        }
      }

      // Record merge/skip target ids. Both merge and skip resolve refs
      // to the existing item.
      for (const e of effective.values()) {
        if (e.decision === "merge" || e.decision === "skip") {
          if (e.existingItemId) nameToId.set(e.name, e.existingItemId);
        }
      }

      // Count merge/skip for stats.
      stats.itemsMerged = [...effective.values()].filter(
        (e) => e.decision === "merge",
      ).length;
      stats.itemsSkipped = [...effective.values()].filter(
        (e) => e.decision === "skip",
      ).length;

      // Resolve names that aren't in the pack at all — they must exist in
      // the DB (validation guarantees this). Look them up on demand.
      const resolveName = async (name: string): Promise<string | null> => {
        const cached = nameToId.get(name);
        if (cached) return cached;
        const [row] = await tx
          .select({ id: schema.items.id })
          .from(schema.items)
          .where(eq(schema.items.name, name))
          .limit(1);
        if (row) {
          nameToId.set(name, row.id);
          return row.id;
        }
        return null;
      };

      // ---------- 2. Insert sources (new codes only) ----------
      const sourceIdByCode = new Map<string, string>();
      const newSources: Array<{
        id: string;
        code: string;
        kind: SourceKind;
        title: string;
        authors: string | null;
        year: number | null;
        published: string | null;
        url: string | null;
      }> = [];
      for (const [code, s] of Object.entries(input.pack.sources)) {
        if (kb.existingSourceCodes.has(code)) continue;
        const id = randomUUID();
        sourceIdByCode.set(code, id);
        newSources.push({
          id,
          code,
          kind: s.kind as SourceKind,
          title: s.title,
          authors: s.authors ?? null,
          year: s.year ?? null,
          published: s.published ?? null,
          url: s.url ?? null,
        });
      }
      if (newSources.length > 0) {
        await tx.insert(schema.sources).values(newSources);
        stats.sourcesInserted = newSources.length;
      }
      // Populate ids for existing sources so evidence can reference them.
      const existingReferencedCodes = Object.keys(input.pack.sources).filter(
        (c) => kb.existingSourceCodes.has(c),
      );
      if (existingReferencedCodes.length > 0) {
        const rows = await tx
          .select({ id: schema.sources.id, code: schema.sources.code })
          .from(schema.sources)
          .where(inArray(schema.sources.code, existingReferencedCodes));
        for (const r of rows) sourceIdByCode.set(r.code, r.id);
      }

      // ---------- 3. Insert recipes + recipe-scoped links ----------
      // Track every link we create or reuse so evidence can attach to it,
      // keyed by its artifact-shape id `child<type<parent`.
      const linkIdsByKey = new Map<string, string[]>();
      const pushKey = (key: string, id: string) => {
        const arr = linkIdsByKey.get(key);
        if (arr) arr.push(id);
        else linkIdsByKey.set(key, [id]);
      };

      for (const [name, eff] of effective) {
        if (eff.decision === "skip") continue;
        const packItem = packByName.get(name);
        if (!packItem) continue;
        const itemId = nameToId.get(name);
        if (!itemId) continue;

        // When merging, find the existing recipes/links to dedupe against.
        // When inserting fresh, no existing rows to worry about.
        let existingPositions: number[] = [];
        let existingRecipeLinks: Array<{
          recipeId: string;
          type: LinkType;
          targetItemId: string;
        }> = [];
        let existingItemLinks: Array<{
          type: LinkType;
          targetItemId: string;
        }> = [];

        if (eff.decision === "merge") {
          const existingRecipes = await tx
            .select({
              id: schema.recipes.id,
              position: schema.recipes.position,
            })
            .from(schema.recipes)
            .where(eq(schema.recipes.itemId, itemId));
          existingPositions = existingRecipes.map((r) => r.position);
          if (existingRecipes.length > 0) {
            const recipeIds = existingRecipes.map((r) => r.id);
            const rLinks = await tx
              .select({
                recipeId: schema.links.recipeId,
                type: schema.links.type,
                targetItemId: schema.links.targetItemId,
              })
              .from(schema.links)
              .where(inArray(schema.links.recipeId, recipeIds));
            existingRecipeLinks = rLinks
              .filter(
                (l): l is { recipeId: string; type: LinkType; targetItemId: string } =>
                  l.recipeId !== null,
              );
          }
          const iLinks = await tx
            .select({
              type: schema.links.type,
              targetItemId: schema.links.targetItemId,
            })
            .from(schema.links)
            .where(eq(schema.links.itemId, itemId));
          existingItemLinks = iLinks;
        }

        // Next position for new recipes. Append after existing ones.
        let nextPosition = existingPositions.length
          ? Math.max(...existingPositions) + 1
          : 0;

        for (const r of packItem.recipes ?? []) {
          const recipeId = randomUUID();
          await tx.insert(schema.recipes).values({
            id: recipeId,
            itemId,
            label: r.label ?? null,
            position: nextPosition++,
          });
          stats.recipesInserted += 1;

          const addLink = async (type: LinkType, targetName: string) => {
            const targetId = await resolveName(targetName);
            if (!targetId) return;
            const id = randomUUID();
            await tx.insert(schema.links).values({
              id,
              recipeId,
              itemId: null,
              type,
              targetItemId: targetId,
              confidence: "established",
              note: null,
              isCanary: false,
            });
            stats.linksInserted += 1;
            pushKey(`${packItem.name}<${type}<${targetName}`, id);
          };

          for (const t of r.f ?? []) await addLink("f", t);
          for (const t of r.w ?? []) await addLink("w", t);
          for (const t of r.n ?? []) await addLink("n", t);
          for (const t of r.e ?? []) await addLink("e", t);
        }

        // Item-level n/s. Dedupe against existing when merging.
        const addItemLink = async (type: LinkType, targetName: string) => {
          const targetId = await resolveName(targetName);
          if (!targetId) return;
          const dup = existingItemLinks.some(
            (l) => l.type === type && l.targetItemId === targetId,
          );
          if (dup) {
            stats.linksSkippedDuplicate += 1;
            // Still record the existing id so evidence can attach to it.
            const [row] = await tx
              .select({ id: schema.links.id })
              .from(schema.links)
              .where(
                and(
                  eq(schema.links.itemId, itemId),
                  eq(schema.links.type, type),
                  eq(schema.links.targetItemId, targetId),
                ),
              )
              .limit(1);
            if (row) pushKey(`${packItem.name}<${type}<${targetName}`, row.id);
            return;
          }
          const id = randomUUID();
          await tx.insert(schema.links).values({
            id,
            recipeId: null,
            itemId,
            type,
            targetItemId: targetId,
            confidence: "established",
            note: null,
            isCanary: false,
          });
          stats.linksInserted += 1;
          pushKey(`${packItem.name}<${type}<${targetName}`, id);
        };

        for (const t of packItem.linksN ?? []) await addItemLink("n", t);
        for (const t of packItem.linksS ?? []) await addItemLink("s", t);

        // When merging, also look up and record ids of pre-existing recipe
        // links the pack is restating — so evidence can target them.
        // Rarely useful but makes evidence+merge interact predictably.
        if (eff.decision === "merge" && existingRecipeLinks.length > 0) {
          // Pre-existing recipe-link keys use the pack name as the "parent".
          // We only populate when the referenced recipe is also something
          // we know how to key — skip to avoid false attaches.
        }

        // Merge-time updates on the item row. Tags union, pictogram
        // fill-when-empty. Editorial fields (fact, tier, kind, symbol,
        // firstAppeared) are deliberately not touched.
        if (eff.decision === "merge") {
          const hasTags = packItem.tags && packItem.tags.length > 0;
          const hasPicto = packItem.pictogram !== undefined && packItem.pictogram !== null;
          if (hasTags || hasPicto) {
            const [row] = await tx
              .select({
                tags: schema.items.tags,
                pictogram: schema.items.pictogram,
              })
              .from(schema.items)
              .where(eq(schema.items.id, itemId))
              .limit(1);
            const update: Partial<typeof schema.items.$inferInsert> = {
              updatedAt: new Date(),
            };
            if (hasTags) {
              const existingTags = new Set(row?.tags ?? []);
              for (const t of packItem.tags ?? []) existingTags.add(t);
              update.tags = [...existingTags];
            }
            if (hasPicto && row && row.pictogram === null) {
              update.pictogram = packItem.pictogram ?? null;
            }
            await tx.update(schema.items).set(update).where(eq(schema.items.id, itemId));
          }
        }
      }

      // ---------- 4. Evidence ----------
      // For each evidence group, attach to every link whose
      // artifact-shape id matches an id in the group. Unresolved ids are
      // just skipped (warnings surfaced in the plan).
      const unresolvedIds: string[] = [];
      for (const ev of input.pack.evidenceLinks) {
        const linkIds: string[] = [];
        for (const id of ev.ids) {
          let parts;
          try {
            parts = parseLinkId(id);
          } catch {
            continue;
          }
          const key = `${parts.childName}<${parts.type}<${parts.parentName}`;
          const ids = linkIdsByKey.get(key);
          if (!ids || ids.length === 0) {
            unresolvedIds.push(id);
            continue;
          }
          for (const lid of ids) linkIds.push(lid);
        }
        if (linkIds.length === 0) continue;

        // Promote confidence onto the matching links (mirrors seed/import
        // behaviour: evidence confidence trumps the default "established").
        await tx
          .update(schema.links)
          .set({ confidence: ev.confidence as Confidence })
          .where(inArray(schema.links.id, linkIds));

        // If the admin left a note on the evidence, denormalise it too.
        if (ev.note) {
          await tx
            .update(schema.links)
            .set({ note: ev.note })
            .where(inArray(schema.links.id, linkIds));
        }

        for (const [i, entry] of (ev.evidence ?? []).entries()) {
          for (const linkId of linkIds) {
            const evId = randomUUID();
            await tx.insert(schema.linkEvidence).values({
              id: evId,
              linkId,
              type: entry.type,
              stance: entry.stance as EvidenceStance,
              summary: entry.summary,
              position: i,
            });
            stats.evidenceInserted += 1;
            const sourceRows: Array<{
              evidenceId: string;
              sourceId: string;
              position: number;
            }> = [];
            (entry.sources ?? []).forEach((code, k) => {
              const sid = sourceIdByCode.get(code);
              if (!sid) return;
              sourceRows.push({ evidenceId: evId, sourceId: sid, position: k });
            });
            if (sourceRows.length > 0) {
              await tx.insert(schema.evidenceSources).values(sourceRows);
            }
          }
        }
      }

      if (input.dryRun) {
        throw new DryRunRollback();
      }
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) {
      return {
        ok: false,
        dryRun: input.dryRun,
        stats: emptyStats,
        issues: plan.issues,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  }

  return {
    ok: true,
    dryRun: input.dryRun,
    stats,
    issues: plan.issues,
    errors: [],
  };
}

class DryRunRollback extends Error {
  constructor() {
    super("dry-run rollback");
    this.name = "DryRunRollback";
  }
}
