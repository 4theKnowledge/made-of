// Server-side loader shared by /account (server component) and
// /api/account/stats (JSON endpoint). Keeps the Drizzle queries in one place.

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import {
  computeCombineStats,
  type CombineCompletion,
  type CombineRow,
  type CombineRun,
  type CombineRunResult,
  type CombineStats,
} from "./combine";
import {
  computeCraftStats,
  type CraftResult,
  type CraftRow,
  type CraftStats,
} from "./craft";

export type AccountStats = {
  craft: CraftStats;
  combine: CombineStats;
};

export async function loadAccountStats(userId: string): Promise<AccountStats> {
  const db = getDb();

  const [craftRows, combineRows, combineRunRows, completionRows] = await Promise.all([
    db
      .select({
        ref: schema.progress.ref,
        createdAt: schema.progress.createdAt,
        result: schema.progress.result,
      })
      .from(schema.progress)
      .where(
        and(
          eq(schema.progress.userId, userId),
          eq(schema.progress.kind, "craft"),
        ),
      ),
    db
      .select({
        itemId: schema.combineDiscoveries.itemId,
        firstFoundAt: schema.combineDiscoveries.firstFoundAt,
        scope: schema.combineDiscoveries.scope,
        tier: schema.items.tier,
      })
      .from(schema.combineDiscoveries)
      .innerJoin(
        schema.items,
        eq(schema.combineDiscoveries.itemId, schema.items.id),
      )
      .where(eq(schema.combineDiscoveries.userId, userId)),
    db
      .select({
        ref: schema.progress.ref,
        createdAt: schema.progress.createdAt,
        result: schema.progress.result,
      })
      .from(schema.progress)
      .where(
        and(
          eq(schema.progress.userId, userId),
          eq(schema.progress.kind, "combine"),
        ),
      ),
    // T-0217 slice 3: completion rows, left-joined to combine_themes for
    // the display label. A theme that was deleted after the player
    // completed it still has a progress row; fall back to the code.
    db
      .select({
        themeCode: schema.progress.ref,
        createdAt: schema.progress.createdAt,
        result: schema.progress.result,
        themeLabel: schema.combineThemes.label,
      })
      .from(schema.progress)
      .leftJoin(
        schema.combineThemes,
        eq(schema.progress.ref, schema.combineThemes.code),
      )
      .where(
        and(
          eq(schema.progress.userId, userId),
          eq(schema.progress.kind, "combine-theme-complete"),
        ),
      ),
  ]);

  const craft = computeCraftStats(
    craftRows
      .filter(
        (r): r is typeof r & { result: CraftResult } => isCraftResult(r.result),
      )
      .map(
        (r): CraftRow => ({
          ref: r.ref,
          createdAt: r.createdAt,
          result: r.result,
        }),
      ),
  );

  const combineRuns: CombineRun[] = combineRunRows
    .filter(
      (r): r is typeof r & { result: CombineRunResult } =>
        isCombineRunResult(r.result),
    )
    .map((r) => ({ ref: r.ref, createdAt: r.createdAt, result: r.result }));

  const completions: CombineCompletion[] = completionRows
    .map((r): CombineCompletion | null => {
      const result = (r.result ?? {}) as Partial<{
        version: number;
        itemCount: number;
      }>;
      if (
        typeof result.version !== "number" ||
        typeof result.itemCount !== "number"
      ) {
        return null;
      }
      return {
        themeCode: r.themeCode,
        themeLabel: r.themeLabel ?? r.themeCode,
        completedVersion: result.version,
        itemCount: result.itemCount,
        completedAt: r.createdAt,
      };
    })
    .filter((x): x is CombineCompletion => x !== null);

  const combine = computeCombineStats(
    combineRows as readonly CombineRow[],
    combineRuns,
    completions,
  );

  return { craft, combine };
}

function isCombineRunResult(v: unknown): v is CombineRunResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.score === "number" && typeof r.made === "number";
}

function isCraftResult(v: unknown): v is CraftResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.moves === "number" &&
    typeof r.par === "number" &&
    typeof r.hints === "number" &&
    typeof r.timeMs === "number" &&
    typeof r.stars === "number" &&
    typeof r.points === "number" &&
    typeof r.badHides === "number"
  );
}
