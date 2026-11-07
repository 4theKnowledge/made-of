/**
 * DB access helpers for server-authoritative Combine runs (T-0175).
 *
 * All reads/writes to `combine_runs` go through this module so the
 * API routes stay thin and the invariants (one active run per
 * (owner, mode, dailyKey); epoch is monotonic; status transitions are
 * one-way) have a single enforcer.
 */

import { and, desc, eq, sql } from "drizzle-orm";
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

/** Fetch the active run for (owner, mode, dailyKey) if one exists. */
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
  return row ?? null;
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
  return db
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
