/**
 * Server-side glue between the pure scheduler and the DB. Imported by the
 * admin regenerate route, the internal cron extend route, and the server
 * component that resolves today's payload at page-load time.
 */

import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Snapshot } from "../graph/snapshot";
import { buildThemeBundle, type GuestRecipeExtension } from "./data";
import {
  buildSchedule,
  cappedBuildableSet,
  type DailyPayload,
  dayRange,
  reachableGuestRecipe,
  type ScheduleInput,
} from "./daily-schedule";
import { getActiveDaily } from "./daily-config-db";
import { todayKey } from "./rng";
import type { ThemeKey } from "./types";

const UTC_TODAY = (): string => todayKey(new Date());

/** Return today's (or the requested day's) payload for a theme, or null if
 *  no row exists yet. Null means "fall back to zero guests at runtime." */
export async function getDailyPayload(
  themeCode: string,
  day: string,
): Promise<DailyPayload | null> {
  const db = getDb();
  const rows = await db
    .select({ payload: schema.combineDailies.payload })
    .from(schema.combineDailies)
    .where(
      and(
        eq(schema.combineDailies.themeCode, themeCode),
        eq(schema.combineDailies.day, day),
      ),
    )
    .limit(1);
  if (!rows[0]) return null;
  return rows[0].payload as DailyPayload;
}

/** Resolve a list of guest output ids to `GuestRecipeExtension`s against
 *  a theme's full and capped bundles. Outputs whose recipes have no path
 *  through the capped bundle are dropped (those are logged for admin
 *  review via the warnings list on the regenerate response). */
export function resolveGuestRecipes(
  fullBundle: ReturnType<typeof buildThemeBundle>,
  cappedBundle: ReturnType<typeof buildThemeBundle>,
  guestOutputIds: string[],
): { extensions: GuestRecipeExtension[]; unresolved: string[] } {
  const buildable = cappedBuildableSet(cappedBundle);
  const extensions: GuestRecipeExtension[] = [];
  const unresolved: string[] = [];
  for (const id of guestOutputIds) {
    const r = reachableGuestRecipe(fullBundle, id, buildable);
    if (r) extensions.push({ recipe: r });
    else unresolved.push(id);
  }
  return { extensions, unresolved };
}

/** Extend or regenerate the active daily's schedule. Reads the singleton
 *  daily config, builds the full + capped bundles for its theme, pulls
 *  prior rows for rotation state, writes new rows via upsert.
 *
 *  - `mode: "extend"` only writes days that don't already have a row.
 *  - `mode: "regenerate"` wipes days ≥ today and rewrites them.
 *
 *  Returns summary counts plus the newly written payloads so admin UI can
 *  render the schedule immediately. `themeCode` in the result lets the
 *  caller know which theme received the schedule. */
export async function scheduleActiveDaily(
  snapshot: Snapshot,
  mode: "extend" | "regenerate",
  days: number = 30,
): Promise<{
  themeCode: ThemeKey | null;
  written: Array<{ day: string; payload: DailyPayload }>;
  skipped: number;
  removed: number;
  unresolvedExamples: string[];
}> {
  const db = getDb();
  const active = await getActiveDaily();
  if (!active) {
    return { themeCode: null, written: [], skipped: 0, removed: 0, unresolvedExamples: [] };
  }
  const { themeCode, config: dailyConfig } = active;

  const fullBundle = buildThemeBundle(snapshot, themeCode);
  // Capped bundle (same theme but with dailyConfig). Shares prevNumAges=0
  // with the full build; buildAllDailyBundles handles seasons separately.
  const cappedBundle = buildThemeBundle(
    snapshot,
    themeCode,
    0,
    "daily",
    dailyConfig,
  );

  const today = UTC_TODAY();
  let removed = 0;
  if (mode === "regenerate") {
    const del = await db
      .delete(schema.combineDailies)
      .where(
        and(
          eq(schema.combineDailies.themeCode, themeCode),
          gte(schema.combineDailies.day, today),
        ),
      )
      .returning({ day: schema.combineDailies.day });
    removed = del.length;
  }

  // Load prior rows for rotation history.
  const priorRowsRaw = await db
    .select({
      day: schema.combineDailies.day,
      payload: schema.combineDailies.payload,
    })
    .from(schema.combineDailies)
    .where(eq(schema.combineDailies.themeCode, themeCode));
  const priorRows = priorRowsRaw.map((r) => ({
    day: r.day,
    payload: r.payload as DailyPayload,
  }));

  const input: ScheduleInput = { theme: themeCode, fullBundle, dailyConfig };

  // For "extend", start one day after the latest scheduled day (or today
  // if nothing exists). For "regenerate", start at today.
  let startDay: string;
  const existingDays = new Set(priorRows.map((r) => r.day));
  if (mode === "regenerate") {
    startDay = today;
  } else {
    // Find latest-scheduled day ≥ today. If none, start today.
    const future = priorRows.map((r) => r.day).filter((d) => d >= today).sort();
    if (!future.length) {
      startDay = today;
    } else {
      // Fill forward from the day after the last scheduled.
      startDay = future[future.length - 1];
      // nextDay is in daily-schedule.ts; reproduce quickly here.
      const d = new Date(`${startDay}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      startDay = d.toISOString().slice(0, 10);
    }
  }

  const schedule = buildSchedule(input, startDay, days, priorRows);
  const unresolvedExamples = new Set<string>();

  // Validate each payload: drop any guest output we can't resolve to a
  // reachable recipe (its ingredients don't live in the capped bundle).
  // The admin can still see these in the "unresolved" preview to fix the
  // config.
  const toUpsert: Array<{ day: string; payload: DailyPayload }> = [];
  for (const row of schedule) {
    const { extensions: _, unresolved } = resolveGuestRecipes(
      fullBundle,
      cappedBundle,
      row.payload.guestOutputIds,
    );
    for (const u of unresolved) unresolvedExamples.add(u);
    // Keep the original payload — we don't rewrite guestOutputIds based
    // on resolvability. Runtime drops unresolved ones silently; admin UI
    // calls out the mismatch.
    toUpsert.push(row);
  }

  let skipped = 0;
  const written: Array<{ day: string; payload: DailyPayload }> = [];
  for (const row of toUpsert) {
    if (mode === "extend" && existingDays.has(row.day)) {
      skipped++;
      continue;
    }
    await db
      .insert(schema.combineDailies)
      .values({ themeCode, day: row.day, payload: row.payload })
      .onConflictDoUpdate({
        target: [schema.combineDailies.themeCode, schema.combineDailies.day],
        set: { payload: row.payload },
      });
    written.push(row);
  }

  return {
    themeCode,
    written,
    skipped,
    removed,
    unresolvedExamples: [...unresolvedExamples].slice(0, 20),
  };
}

/** Read the next N days of scheduled payloads for a theme, starting at
 *  today. Used by the admin review UI. */
export async function readSchedule(
  themeCode: string,
  days: number = 30,
): Promise<Array<{ day: string; payload: DailyPayload }>> {
  const db = getDb();
  const today = UTC_TODAY();
  const wanted = dayRange(today, days);
  const rows = await db
    .select({
      day: schema.combineDailies.day,
      payload: schema.combineDailies.payload,
    })
    .from(schema.combineDailies)
    .where(
      and(
        eq(schema.combineDailies.themeCode, themeCode),
        inArray(schema.combineDailies.day, wanted),
      ),
    );
  const byDay = new Map(rows.map((r) => [r.day, r.payload as DailyPayload]));
  return wanted.map((day) => ({
    day,
    payload: byDay.get(day) ?? emptyPayload(),
  }));
}

function emptyPayload(): DailyPayload {
  return {
    version: 1,
    config: {},
    guestOutputIds: [],
    seed: 0,
    generatedAt: new Date(0).toISOString(),
  };
}
