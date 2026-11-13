/**
 * Server-side glue between the pure scheduler and the DB. Imported by the
 * admin regenerate route, the internal cron extend route, and the server
 * component that resolves today's payload at page-load time.
 */

import { and, eq, gt, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Snapshot } from "../graph/snapshot";
import { buildThemeBundle, type GuestRecipeExtension } from "./data";
import {
  buildDailyPayload,
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
import {
  buildClusterManifest,
  buildManifestForDay,
  computeDifficulty,
  filterManifestPool,
  manifestTurnBudget,
  resolveManifestPool,
  UnreachablePin,
  UnreachableManifest,
} from "./manifest-solver";
import { DEFAULT_MANIFEST_SIZE } from "./daily-config";

/** Pool size below which cluster sampling degenerates — not enough items
 *  to find `m` seeds at `MIN_SEED_DISTANCE` apart. Below this threshold
 *  we fall through to the older single-pool sampler which just enforces
 *  reachability + difficulty. */
const CLUSTER_SAMPLER_MIN_POOL = 20;

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
    // Protect today's row: players may already be mid-run on it. Only
    // wipe strictly future days. If the admin genuinely needs to force a
    // new today-roll, deleting the (themeCode, today) row directly via
    // SQL is still available — but the regenerate button never does it.
    const del = await db
      .delete(schema.combineDailies)
      .where(
        and(
          eq(schema.combineDailies.themeCode, themeCode),
          gt(schema.combineDailies.day, today),
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
  // if nothing exists). For "regenerate", start tomorrow — today's row is
  // intentionally protected from reroll so an admin tweak doesn't shift
  // guests under players who are already mid-run.
  let startDay: string;
  const existingDays = new Set(priorRows.map((r) => r.day));
  const dayAfter = (d: string): string => {
    const dt = new Date(`${d}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString().slice(0, 10);
  };
  if (mode === "regenerate") {
    startDay = dayAfter(today);
  } else {
    // Find latest-scheduled day ≥ today. If none, start today.
    const future = priorRows.map((r) => r.day).filter((d) => d >= today).sort();
    if (!future.length) {
      startDay = today;
    } else {
      // Fill forward from the day after the last scheduled.
      startDay = dayAfter(future[future.length - 1]);
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
    toUpsert.push(row);
  }

  // Manifest build-up (T-0242). Each day's payload gets a frozen
  // manifest resolved from `config.manifest.pool` membership + rotation
  // history + the headless simulator. Days where the manifest can't be
  // built (unreachable pins, simulator failures) have their payload
  // dropped from the upsert so the admin sees the problem and fixes it
  // before any player starts a broken run.
  //
  // Rotation history for manifests is independent of the guest rotation
  // — mirror the pattern but key on `manifestHistoryByOutput`. Items
  // not scheduled in the rotation window win placement priority.
  if (dailyConfig.manifest) {
    const pool = await fetchManifestPool(dailyConfig.manifest.pool);
    const resolvedPool = resolveManifestPool(pool, cappedBundle);
    // Precompute per-item difficulty once per bundle (cached in a
    // WeakMap keyed on the bundle object). Lets `buildManifestForDay`
    // run a budgeted sample + skip sim-unsolvable items instead of
    // discovering them day-by-day through failed sim retries.
    const difficulty = computeDifficulty(cappedBundle, themeCode);
    // Hoist the sampler-eligible pool + turn budget: both depend only
    // on (bundle, config, pool, difficulty), none of which change
    // across the 30-day loop. Doing the filter once saves an
    // `isReachable` sweep per day.
    const filtered = filterManifestPool({
      cappedBundle,
      config: dailyConfig.manifest,
      pool: resolvedPool,
      difficulty,
    });
    const sharedTurnBudget = manifestTurnBudget({
      size: dailyConfig.manifest.size ?? DEFAULT_MANIFEST_SIZE,
      pool: filtered.reachablePool,
      difficulty,
    });
    const manifestHistory = buildManifestRotation(priorRows, startDay);
    const useClusterSampler = resolvedPool.length >= CLUSTER_SAMPLER_MIN_POOL;
    for (let i = 0; i < toUpsert.length; i++) {
      const row = toUpsert[i];
      try {
        if (filtered.unreachablePin) throw new UnreachablePin(filtered.unreachablePin);
        const build = useClusterSampler
          ? buildClusterManifest({
              cappedBundle,
              theme: themeCode,
              config: dailyConfig.manifest,
              day: row.day,
              pool: resolvedPool,
              reachablePool: filtered.reachablePool,
              rotation: perDayRotation(manifestHistory, row.day),
              difficulty,
              turnBudget: sharedTurnBudget,
            })
          : buildManifestForDay({
              cappedBundle,
              theme: themeCode,
              config: dailyConfig.manifest,
              day: row.day,
              pool: resolvedPool,
              reachablePool: filtered.reachablePool,
              rotation: perDayRotation(manifestHistory, row.day),
              difficulty,
              turnBudget: sharedTurnBudget,
            });
        const { manifest } = build;
        row.payload = { ...row.payload, manifest };
        // Update rolling history so subsequent days see today's picks.
        for (const id of manifest) manifestHistory.set(id, row.day);
      } catch (err) {
        if (err instanceof UnreachablePin || err instanceof UnreachableManifest) {
          console.error(
            `[schedule] manifest build failed for ${row.day}:`,
            err.message,
          );
          // Null out so the skip filter below drops the day. The admin
          // UI sees the unresolved IDs via the pin / manifest's items.
          if (err instanceof UnreachablePin) unresolvedExamples.add(err.pin);
          else for (const id of err.manifest) unresolvedExamples.add(id);
          toUpsert[i] = { day: row.day, payload: null as unknown as DailyPayload };
        } else {
          throw err;
        }
      }
      // Yield the event loop so concurrent API requests get served
      // between days. Without this, the 30-day loop monopolises the
      // Node worker for the duration of the regenerate.
      await new Promise((r) => setImmediate(r));
    }
  }

  let skipped = 0;
  const written: Array<{ day: string; payload: DailyPayload }> = [];
  for (const row of toUpsert) {
    if (row.payload == null) {
      // Manifest build failed for this day — skip the write so admin
      // sees the unresolved IDs and fixes the pool / pins. Players
      // see no row for that day (resolves to the empty payload
      // fallback at runtime, which the engine refuses to win).
      skipped++;
      continue;
    }
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
    await new Promise((r) => setImmediate(r));
  }

  return {
    themeCode,
    written,
    skipped,
    removed,
    unresolvedExamples: [...unresolvedExamples].slice(0, 20),
  };
}

/** Overwrite today's `combine_dailies` row for the active daily theme.
 *
 *  Unlike `scheduleActiveDaily("regenerate")`, which deliberately protects
 *  today's row, this function is the single escape hatch for the "Reset
 *  today's daily" admin button. It:
 *    1. Reads the current active daily config.
 *    2. Rebuilds the full + capped bundles.
 *    3. Replays the rotation state across all prior days to compute the
 *       correct `recent` map for today.
 *    4. Upserts a fresh payload for (themeCode, today).
 *
 *  It does NOT touch other days, player `progress` rows, or
 *  `combine_discoveries`. The caller (admin API route) is responsible for
 *  rate limiting, admin-auth, audit logging, and any optional progress
 *  wipe.
 *
 *  Returns `null` when no active daily is configured. */
export async function resetTodaySchedule(
  snapshot: Snapshot,
): Promise<{
  themeCode: ThemeKey;
  payload: DailyPayload;
  unresolvedExamples: string[];
} | null> {
  const db = getDb();
  const active = await getActiveDaily();
  if (!active) return null;
  const { themeCode, config: dailyConfig } = active;

  const fullBundle = buildThemeBundle(snapshot, themeCode);
  const cappedBundle = buildThemeBundle(
    snapshot,
    themeCode,
    0,
    "daily",
    dailyConfig,
  );

  // Pull prior rows so rotation history advances correctly when we rebuild
  // today. `buildSchedule` normally handles this; we inline the same
  // walking map for a single-day build.
  const priorRowsRaw = await db
    .select({
      day: schema.combineDailies.day,
      payload: schema.combineDailies.payload,
    })
    .from(schema.combineDailies)
    .where(eq(schema.combineDailies.themeCode, themeCode));
  const today = UTC_TODAY();
  // Only days strictly before today contribute to rotation state. Today's
  // own prior payload is being overwritten and must not vote for itself.
  const history = priorRowsRaw
    .map((r) => ({ day: r.day, payload: r.payload as DailyPayload }))
    .filter((r) => r.day < today)
    .sort((a, b) => a.day.localeCompare(b.day));

  const lastServed = new Map<string, string>();
  for (const row of history) {
    for (const id of row.payload.guestOutputIds) {
      lastServed.set(id, row.day);
    }
  }
  const recent = new Map<string, number>();
  for (const [id, served] of lastServed) {
    const a = new Date(`${served}T00:00:00Z`).getTime();
    const b = new Date(`${today}T00:00:00Z`).getTime();
    recent.set(id, Math.round((b - a) / 86_400_000));
  }

  const input: ScheduleInput = { theme: themeCode, fullBundle, dailyConfig };
  let payload = buildDailyPayload(input, today, recent);

  // Collect unresolved guests for the admin feedback card.
  const { unresolved } = resolveGuestRecipes(
    fullBundle,
    cappedBundle,
    payload.guestOutputIds,
  );

  // Manifest (T-0242 / T-0251). Mirrors the schedule-build path: when the
  // active daily has a manifest config, resolve its pool, build (or
  // cluster-sample) the day's manifest, and splice it into the payload.
  // Without this, resetTodaySchedule would write an empty manifest and
  // today's run would never satisfy the win condition.
  const unresolvedFromManifest = new Set<string>();
  if (dailyConfig.manifest) {
    const poolRaw = await fetchManifestPool(dailyConfig.manifest.pool);
    const resolvedPool = resolveManifestPool(poolRaw, cappedBundle);
    const difficulty = computeDifficulty(cappedBundle, themeCode);
    // Rotation for manifest items (independent of guests). Replay the
    // manifest history across prior rows.
    const manifestRotation = new Map<string, number>();
    const manifestHistory = new Map<string, string>();
    for (const row of history) {
      for (const id of row.payload.manifest ?? []) {
        manifestHistory.set(id, row.day);
      }
    }
    for (const [id, served] of manifestHistory) {
      const a = new Date(`${served}T00:00:00Z`).getTime();
      const b = new Date(`${today}T00:00:00Z`).getTime();
      manifestRotation.set(id, Math.round((b - a) / 86_400_000));
    }
    try {
      const useCluster = resolvedPool.length >= CLUSTER_SAMPLER_MIN_POOL;
      const build = useCluster
        ? buildClusterManifest({
            cappedBundle,
            theme: themeCode,
            config: dailyConfig.manifest,
            day: today,
            pool: resolvedPool,
            rotation: manifestRotation,
            difficulty,
          })
        : buildManifestForDay({
            cappedBundle,
            theme: themeCode,
            config: dailyConfig.manifest,
            day: today,
            pool: resolvedPool,
            rotation: manifestRotation,
            difficulty,
          });
      payload = { ...payload, manifest: build.manifest };
    } catch (err) {
      if (err instanceof UnreachablePin) unresolvedFromManifest.add(err.pin);
      else if (err instanceof UnreachableManifest) {
        for (const id of err.manifest) unresolvedFromManifest.add(id);
      } else throw err;
    }
  }

  await db
    .insert(schema.combineDailies)
    .values({ themeCode, day: today, payload })
    .onConflictDoUpdate({
      target: [schema.combineDailies.themeCode, schema.combineDailies.day],
      set: { payload },
    });

  return {
    themeCode,
    payload,
    unresolvedExamples: [
      ...unresolved,
      ...unresolvedFromManifest,
    ].slice(0, 20),
  };
}

/** Read a window of scheduled payloads centred on today for the admin
 *  review UI. `pastDays` counts historical days before today (immutable,
 *  shown read-only in the UI); `futureDays` counts today-forward. Default
 *  14 past + 30 future gives the admin ~2 weeks of context on what was
 *  served + the full upcoming schedule.
 *
 *  Days without a row return an empty payload so the UI can render a
 *  placeholder row rather than a gap. */
export async function readSchedule(
  themeCode: string,
  futureDays: number = 30,
  pastDays: number = 14,
): Promise<Array<{ day: string; payload: DailyPayload; isPast: boolean }>> {
  const db = getDb();
  const today = UTC_TODAY();
  // Build the window: [today - pastDays, today - 1] + [today, today + futureDays - 1].
  const past: string[] = [];
  if (pastDays > 0) {
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - pastDays);
    past.push(...dayRange(start.toISOString().slice(0, 10), pastDays));
  }
  const future = dayRange(today, futureDays);
  const wanted = [...past, ...future];
  if (wanted.length === 0) return [];
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
    isPast: day < today,
  }));
}

function emptyPayload(): DailyPayload {
  return {
    version: 1,
    config: {},
    guestOutputIds: [],
    seed: 0,
    manifest: [],
    generatedAt: new Date(0).toISOString(),
  };
}

/** Fetch every item id that's a member of a given combine_themes.code.
 *  Scoped to live items (status=live) so admin-only drafts don't leak
 *  into a scheduled manifest. */
export async function fetchManifestPool(themeCode: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ itemId: schema.itemCombineThemes.itemId })
    .from(schema.itemCombineThemes)
    .innerJoin(
      schema.items,
      eq(schema.items.id, schema.itemCombineThemes.itemId),
    )
    .where(
      and(
        eq(schema.itemCombineThemes.themeCode, themeCode),
        eq(schema.items.status, "live"),
      ),
    );
  return rows.map((r) => r.itemId);
}

/** Replay the manifest history across prior rows to build an
 *  outputId → last-served-day map. Only rows strictly before `before`
 *  are considered — days scheduled on or after `before` are being
 *  (re)built and shouldn't count as "already served". */
function buildManifestRotation(
  priorRows: Array<{ day: string; payload: DailyPayload }>,
  before: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const sorted = priorRows
    .filter((r) => r.day < before)
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day));
  for (const row of sorted) {
    for (const id of row.payload.manifest ?? []) {
      map.set(id, row.day);
    }
  }
  return map;
}

/** From a rolling history map and a day, compute per-id
 *  days-since-last-served. Matches the shape `pickGuests` / the
 *  solver expects. */
function perDayRotation(
  history: Map<string, string>,
  day: string,
): Map<string, number> {
  const out = new Map<string, number>();
  const target = new Date(`${day}T00:00:00Z`).getTime();
  for (const [id, served] of history) {
    const t = new Date(`${served}T00:00:00Z`).getTime();
    const delta = Math.round((target - t) / 86400000);
    if (delta >= 0) out.set(id, delta);
  }
  return out;
}
