// Server-side loader for the /account/collections page. Returns every
// Combine discovery the user has, split by scope, joined with items so
// the UI can render pictograms + metadata without a second fetch.
//
// Scope semantics match combine_discoveries.scope:
//   - endless: shared across all endless themes (Everything + future ones)
//   - daily:   isolated pool, so endless grinding can't carry over
//
// Rows are sorted newest-first per scope so the view reads as a timeline
// of recent finds. Tier aggregates are recomputed here rather than reused
// from AccountStats so the two pages can evolve independently.

import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Tier } from "@/db/schema";

export type CollectionsScope = "endless" | "daily";

export type DiscoveredItem = {
  itemId: string;
  slug: string;
  name: string;
  tier: Tier;
  kind: string;
  symbol: string | null;
  pictogram: string | null;
  firstFoundAt: Date;
};

export type ScopeCollection = {
  total: number;
  byTier: Record<Tier, number>;
  items: DiscoveredItem[];
};

export type AccountCollections = {
  endless: ScopeCollection;
  daily: ScopeCollection;
};

const EMPTY_BY_TIER: Record<Tier, number> = {
  F: 0,
  N: 0,
  M: 0,
  C: 0,
  P: 0,
  S: 0,
};

function emptyScope(): ScopeCollection {
  return { total: 0, byTier: { ...EMPTY_BY_TIER }, items: [] };
}

export async function loadAccountCollections(
  userId: string,
): Promise<AccountCollections> {
  const db = getDb();

  const rows = await db
    .select({
      itemId: schema.combineDiscoveries.itemId,
      scope: schema.combineDiscoveries.scope,
      firstFoundAt: schema.combineDiscoveries.firstFoundAt,
      slug: schema.items.slug,
      name: schema.items.name,
      tier: schema.items.tier,
      kind: schema.items.kind,
      symbol: schema.items.symbol,
      pictogram: schema.items.pictogram,
    })
    .from(schema.combineDiscoveries)
    .innerJoin(
      schema.items,
      eq(schema.combineDiscoveries.itemId, schema.items.id),
    )
    .where(eq(schema.combineDiscoveries.userId, userId))
    .orderBy(desc(schema.combineDiscoveries.firstFoundAt));

  const out: AccountCollections = {
    endless: emptyScope(),
    daily: emptyScope(),
  };

  for (const row of rows) {
    const bucket = out[row.scope];
    bucket.total += 1;
    bucket.byTier[row.tier] = (bucket.byTier[row.tier] ?? 0) + 1;
    bucket.items.push({
      itemId: row.itemId,
      slug: row.slug,
      name: row.name,
      tier: row.tier,
      kind: row.kind,
      symbol: row.symbol,
      pictogram: row.pictogram,
      firstFoundAt: row.firstFoundAt,
    });
  }

  return out;
}
