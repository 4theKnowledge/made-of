/**
 * Import a `Data*`-shape payload (see `src/data/types.ts`) into Postgres.
 *
 * Semantics: full replace of KB content, but item ids are preserved across
 * imports. Items are upserted by id (UUIDv5 derived from slug), and items
 * whose slug is no longer in the payload are pruned. Recipes, links,
 * evidence and sources have random ids and are wiped + reinserted. This
 * means FKs from user data (`combine_discoveries`, etc.) keep resolving
 * — an import that re-adds the same slug lands on the same row.
 *
 * New items land as `status='live'` to match the seeder (admins
 * publish/unpublish from the UI). Canary links are not touched here —
 * `buildCanaryLinks()` is reapplied so canaries survive an import.
 *
 * Returns stats including `unresolvedEvidenceIds`. When `dryRun: true` the
 * transaction is rolled back so callers can preview the outcome.
 */

import type {
  DataEvidenceLink,
  DataItem,
  DataSource,
  LoadedKnowledgeBase,
} from "@/data/types";
import {
  normaliseItem as realNormaliseItem,
  slug,
  parseYear,
  parseLinkId,
} from "@/data/load";
import { toRows } from "@/data/rows";
import { buildCanaryLinks } from "@/data/canaries";
import { getDb, schema } from "@/db/client";
import { notInArray, sql } from "drizzle-orm";

export interface AdminImportPayload {
  items: DataItem[];
  evidenceLinks: DataEvidenceLink[];
  sources: Record<string, DataSource>;
}

export interface AdminImportResult {
  ok: boolean;
  dryRun: boolean;
  stats: {
    items: number;
    recipes: number;
    links: number;
    evidence: number;
    sources: number;
    canaries: number;
  };
  warnings: string[];
  errors: string[];
}

export async function runImport(
  payload: AdminImportPayload,
  { dryRun }: { dryRun: boolean },
): Promise<AdminImportResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  // ---------- Payload validation ----------
  if (!payload || typeof payload !== "object") {
    return failed("payload_not_object");
  }
  if (!Array.isArray(payload.items)) return failed("items_not_array");
  if (!Array.isArray(payload.evidenceLinks)) return failed("evidenceLinks_not_array");
  if (!payload.sources || typeof payload.sources !== "object") {
    return failed("sources_not_object");
  }

  // Build the LoadedKnowledgeBase shape manually (we can't use
  // loadKnowledgeBase() because that reads from the on-disk .data.ts files).
  let loaded: LoadedKnowledgeBase;
  try {
    loaded = {
      items: payload.items.map((it) => realNormaliseItem(it)),
      evidenceLinks: payload.evidenceLinks.map((l) => ({
        ids: l.ids,
        confidence: l.confidence,
        note: l.note ?? "",
        evidence: (l.evidence ?? []).map((e) => ({
          type: e.type,
          stance: e.stance,
          summary: e.summary,
          sources: e.sources ?? [],
        })),
      })),
      sources: Object.entries(payload.sources).map(([id, s]) => ({
        id,
        kind: s.kind,
        title: s.title,
        authors: s.authors ?? null,
        year: s.year ?? null,
        published: s.published ?? null,
        url: s.url ?? null,
      })),
    };
    // Touch parse helpers so they're exercised and the compiler keeps them
    // in scope even if we tree-shake load.ts later.
    void slug;
    void parseYear;
    void parseLinkId;
  } catch (err) {
    return failed(`normalise_failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const rows = toRows(loaded);
  if (rows.stats.unresolvedEvidenceIds.length > 0) {
    warnings.push(
      `${rows.stats.unresolvedEvidenceIds.length} evidence ids didn't match any link: ${rows.stats.unresolvedEvidenceIds.slice(0, 5).join(", ")}${rows.stats.unresolvedEvidenceIds.length > 5 ? "…" : ""}`,
    );
  }

  // Preserve canaries across the import. If an item that a canary targets
  // isn't in the payload, drop the canary with a warning rather than failing
  // the whole import — admins can re-add later.
  const canaries = buildCanaryLinks(rows.itemIdBySlug);
  if (canaries.missing.length > 0) {
    warnings.push(`Canary links skipped (unknown items): ${canaries.missing.join(", ")}`);
  }
  rows.links.push(...canaries.links);

  // ---------- Apply (or roll back on dryRun) ----------
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      await tx.delete(schema.evidenceSources);
      await tx.delete(schema.linkEvidence);
      await tx.delete(schema.links);
      await tx.delete(schema.recipes);
      await tx.delete(schema.sources);

      // Prune items no longer in the payload BEFORE upsert so a renamed
      // slug (which changes the derived id) doesn't collide with the old
      // row's unique(slug)/unique(name). Cascades drop their links,
      // recipes, discoveries — correct, since the item is gone.
      const keepIds = rows.items.map((it) => it.id!);
      await tx
        .delete(schema.items)
        .where(keepIds.length === 0 ? sql`true` : notInArray(schema.items.id, keepIds));

      await upsertItems(tx, rows.items);
      await bulkInsert(tx, schema.sources, rows.sources);
      await bulkInsert(tx, schema.recipes, rows.recipes);
      await bulkInsert(tx, schema.links, rows.links);
      await bulkInsert(tx, schema.linkEvidence, rows.linkEvidence);
      await bulkInsert(tx, schema.evidenceSources, rows.evidenceSources);

      if (dryRun) {
        // Roll the transaction back by throwing. The sentinel is caught
        // below to distinguish rollback-on-dryRun from real failures.
        throw new DryRunRollback();
      }
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) {
      errors.push(err instanceof Error ? err.message : String(err));
      return {
        ok: false,
        dryRun,
        stats: zeroStats(),
        warnings,
        errors,
      };
    }
  }

  return {
    ok: true,
    dryRun,
    stats: {
      items: rows.items.length,
      recipes: rows.recipes.length,
      links: rows.links.length,
      evidence: rows.linkEvidence.length,
      sources: rows.sources.length,
      canaries: canaries.links.length,
    },
    warnings,
    errors,
  };

  function failed(reason: string): AdminImportResult {
    return {
      ok: false,
      dryRun,
      stats: zeroStats(),
      warnings,
      errors: [reason],
    };
  }
}

class DryRunRollback extends Error {
  constructor() {
    super("dry-run rollback");
    this.name = "DryRunRollback";
  }
}

function zeroStats() {
  return { items: 0, recipes: 0, links: 0, evidence: 0, sources: 0, canaries: 0 };
}

async function bulkInsert<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  rows: T[],
  chunkSize = 500,
) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await tx.insert(table).values(rows.slice(i, i + chunkSize));
  }
}

/** Upsert items by id. Keeps FK referents (discoveries, reports, daily
 *  puzzles) alive across imports. Mirrors the helper in src/db/seed.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertItems(tx: any, items: any[]) {
  if (items.length === 0) return;
  for (let i = 0; i < items.length; i += 500) {
    await tx
      .insert(schema.items)
      .values(items.slice(i, i + 500))
      .onConflictDoUpdate({
        target: schema.items.id,
        set: {
          slug: sql`excluded.slug`,
          name: sql`excluded.name`,
          tier: sql`excluded.tier`,
          kind: sql`excluded.kind`,
          firstAppeared: sql`excluded.first_appeared`,
          firstAppearedYa: sql`excluded.first_appeared_ya`,
          symbol: sql`excluded.symbol`,
          fact: sql`excluded.fact`,
          pictogram: sql`excluded.pictogram`,
          status: sql`excluded.status`,
          isCanary: sql`excluded.is_canary`,
          tags: sql`excluded.tags`,
          updatedAt: sql`now()`,
        },
      });
  }
}
