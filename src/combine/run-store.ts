/**
 * DB access helpers for server-authoritative Combine runs (T-0175).
 *
 * All reads/writes to `combine_runs` go through this module so the
 * API routes stay thin and the invariants (one active run per
 * (owner, mode, dailyKey); epoch is monotonic; status transitions are
 * one-way) have a single enforcer.
 */

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { CombineRun, CombineRunOwnerKind } from "@/db/schema";
import { ENGINE_VERSION, type GameState } from "./engine";
import type { ServerMode } from "./server-engine";

export interface RunOwnerKey {
  kind: CombineRunOwnerKind;
  id: string;
}

export interface CreateRunArgs {
  owner: RunOwnerKey;
  mode: ServerMode;
  theme: string;
  dailyKey: string | null;
  seed: number;
  state: GameState;
}

/** Create a new active run row. If one already exists for the same
 *  (owner, mode, dailyKey) slot, the caller should either resume it or
 *  explicitly end it first — the partial unique index will throw here
 *  otherwise. Returns the inserted row. */
export async function createRun(args: CreateRunArgs): Promise<CombineRun> {
  const db = getDb();
  const [row] = await db
    .insert(schema.combineRuns)
    .values({
      ownerKind: args.owner.kind,
      ownerId: args.owner.id,
      mode: args.mode,
      theme: args.theme,
      dailyKey: args.dailyKey ?? "",
      seed: args.seed,
      stateJson: args.state as unknown as object,
      eventCount: 0,
      engineVersion: ENGINE_VERSION,
    })
    .returning();
  return row;
}

/** Fetch the active run for (owner, mode, dailyKey) if one exists.
 *  Stale-engine rows are auto-invalidated and treated as absent so the
 *  caller mints a fresh row on the current ENGINE_VERSION instead of
 *  returning a run whose every checkpoint/finish would 409. */
export async function getActiveRun(
  owner: RunOwnerKey,
  mode: ServerMode,
  dailyKey: string | null,
): Promise<CombineRun | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.combineRuns)
    .where(
      and(
        eq(schema.combineRuns.ownerKind, owner.kind),
        eq(schema.combineRuns.ownerId, owner.id),
        eq(schema.combineRuns.mode, mode),
        eq(schema.combineRuns.dailyKey, dailyKey ?? ""),
        eq(schema.combineRuns.status, "active"),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.engineVersion !== ENGINE_VERSION) {
    await invalidateRun(row.id);
    return null;
  }
  return row;
}

/** Fetch a specific run by id, scoped to an owner so one player can't
 *  read another's runs via the URL. */
export async function getRunForOwner(
  runId: string,
  owner: RunOwnerKey,
): Promise<CombineRun | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.combineRuns)
    .where(
      and(
        eq(schema.combineRuns.id, runId),
        eq(schema.combineRuns.ownerKind, owner.kind),
        eq(schema.combineRuns.ownerId, owner.id),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** All active runs for an owner, newest first. Used by `/runs/active`
 *  to let the client pick which to resume on mount. */
export async function listActiveRuns(owner: RunOwnerKey): Promise<CombineRun[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.combineRuns)
    .where(
      and(
        eq(schema.combineRuns.ownerKind, owner.kind),
        eq(schema.combineRuns.ownerId, owner.id),
        eq(schema.combineRuns.status, "active"),
      ),
    )
    .orderBy(desc(schema.combineRuns.updatedAt));
  // Drop stale-engine rows from the resumable set, invalidating them
  // so the next /runs/start mints a fresh row on the current engine
  // version. Without this the client would hydrate from an unplayable
  // run and every checkpoint/finish would 409.
  const stale = rows.filter((r) => r.engineVersion !== ENGINE_VERSION);
  if (stale.length > 0) {
    await Promise.all(stale.map((r) => invalidateRun(r.id)));
  }
  return rows.filter((r) => r.engineVersion === ENGINE_VERSION);
}

/** Most-recent active daily run whose `dailyKey` is strictly before
 *  `today`. Used by the "recover yesterday's abandoned daily" prompt
 *  (T-0333) — the client fetches this on mount, and if present, offers
 *  the player Save (write progress row from stored state) or Discard.
 *
 *  Unlike `listActiveRuns`, this intentionally does NOT filter on
 *  `engineVersion`: a stale-engine row is still a legit abandoned run
 *  and we should let the player bank it (via the stored state, which
 *  the finalize path trusts without replay). Stale-engine rows get
 *  stamped with their original `engineVersion` on the progress row —
 *  mirrors `finalize-legacy` semantics. */
export async function getLatestStaleDailyRun(
  owner: RunOwnerKey,
  today: string,
): Promise<CombineRun | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.combineRuns)
    .where(
      and(
        eq(schema.combineRuns.ownerKind, owner.kind),
        eq(schema.combineRuns.ownerId, owner.id),
        eq(schema.combineRuns.status, "active"),
        eq(schema.combineRuns.mode, "daily"),
        lt(schema.combineRuns.dailyKey, today),
      ),
    )
    .orderBy(desc(schema.combineRuns.updatedAt))
    .limit(1);
  return row ?? null;
}

/** Overwrite a run's state + event count. Used after a successful
 *  checkpoint replay. Expects the row to still be `active`; the
 *  update is a no-op for non-active rows. Returns the updated row. */
export async function saveRunCheckpoint(
  runId: string,
  state: GameState,
  eventCount: number,
): Promise<CombineRun | null> {
  const db = getDb();
  const [row] = await db
    .update(schema.combineRuns)
    .set({
      stateJson: state as unknown as object,
      eventCount,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.combineRuns.id, runId),
        eq(schema.combineRuns.status, "active"),
      ),
    )
    .returning();
  return row ?? null;
}

/** Stamp `startedAt = now()` on an active daily run if it isn't already
 *  set. Idempotent — a second call on the same run returns the existing
 *  row unchanged. Used by `POST /runs/[id]/start-daily` (T-0247) to
 *  record the moment the player commits past the manifest-preview
 *  sheet. `/finish` reads this to compute a server-trusted `durationMs`
 *  instead of trusting the client's clock. */
export async function markRunStarted(
  runId: string,
  owner: RunOwnerKey,
): Promise<CombineRun | null> {
  const db = getDb();
  const existing = await getRunForOwner(runId, owner);
  if (!existing) return null;
  if (existing.status !== "active") return existing;
  if (existing.startedAt != null) return existing;
  const [row] = await db
    .update(schema.combineRuns)
    .set({
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.combineRuns.id, runId),
        eq(schema.combineRuns.status, "active"),
      ),
    )
    .returning();
  return row ?? null;
}

/** Transition a run to `ended`. Idempotent — a second call on an
 *  already-ended row is a no-op that still returns the row. */
export async function endRun(runId: string): Promise<CombineRun | null> {
  const db = getDb();
  const [row] = await db
    .update(schema.combineRuns)
    .set({
      status: "ended",
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.combineRuns.id, runId))
    .returning();
  return row ?? null;
}

/** Transition a run to `invalidated`. Used by admin reset or the
 *  anon→user merge collision path. Idempotent. */
export async function invalidateRun(runId: string): Promise<CombineRun | null> {
  const db = getDb();
  const [row] = await db
    .update(schema.combineRuns)
    .set({
      status: "invalidated",
      endedAt: new Date(),
      updatedAt: new Date(),
      epoch: sql`${schema.combineRuns.epoch} + 1`,
    })
    .where(eq(schema.combineRuns.id, runId))
    .returning();
  return row ?? null;
}

/** Invalidate every active run for a given theme code. Called from admin
 *  mutations that touch a theme's definition or membership — the old bundle
 *  baked into each run's state is now stale, so players bounce back to the
 *  picker via the existing 409 reconciliation path. Returns the count of
 *  rows transitioned. */
export async function invalidateRunsForTheme(theme: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(schema.combineRuns)
    .set({
      status: "invalidated",
      endedAt: new Date(),
      updatedAt: new Date(),
      epoch: sql`${schema.combineRuns.epoch} + 1`,
    })
    .where(
      and(
        eq(schema.combineRuns.theme, theme),
        eq(schema.combineRuns.status, "active"),
      ),
    )
    .returning({ id: schema.combineRuns.id });
  return rows.length;
}

/** Invalidate every active run across all themes. Used by broad admin
 *  operations (bulk uploads, pictogram uploads) where we can't cheaply
 *  enumerate which themes were touched. Returns the count. */
export async function invalidateAllActiveRuns(): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(schema.combineRuns)
    .set({
      status: "invalidated",
      endedAt: new Date(),
      updatedAt: new Date(),
      epoch: sql`${schema.combineRuns.epoch} + 1`,
    })
    .where(eq(schema.combineRuns.status, "active"))
    .returning({ id: schema.combineRuns.id });
  return rows.length;
}

/** Invalidate active runs for a set of theme codes. Safe with an empty
 *  list (no-op). Returns the count of rows transitioned. */
export async function invalidateRunsForThemes(themes: string[]): Promise<number> {
  if (themes.length === 0) return 0;
  const db = getDb();
  const rows = await db
    .update(schema.combineRuns)
    .set({
      status: "invalidated",
      endedAt: new Date(),
      updatedAt: new Date(),
      epoch: sql`${schema.combineRuns.epoch} + 1`,
    })
    .where(
      and(
        inArray(schema.combineRuns.theme, themes),
        eq(schema.combineRuns.status, "active"),
      ),
    )
    .returning({ id: schema.combineRuns.id });
  return rows.length;
}

/** Invalidate active runs for every theme that contains any of the given
 *  items. Used by item/link/recipe admin mutations where the surface knows
 *  which items were touched but not which themes they're in — the join
 *  table resolves that here. Safe with an empty list (no-op). Must be
 *  called BEFORE a delete that would cascade the join rows. */
export async function invalidateRunsForItems(itemIds: string[]): Promise<number> {
  if (itemIds.length === 0) return 0;
  const db = getDb();
  const themeRows = await db
    .selectDistinct({ themeCode: schema.itemCombineThemes.themeCode })
    .from(schema.itemCombineThemes)
    .where(inArray(schema.itemCombineThemes.itemId, itemIds));
  return invalidateRunsForThemes(themeRows.map((r) => r.themeCode));
}
