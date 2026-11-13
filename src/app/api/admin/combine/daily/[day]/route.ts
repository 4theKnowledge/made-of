import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { getLiveSnapshot } from "@/graph/live";
import { getActiveDaily } from "@/combine/daily-config-db";
import { buildThemeBundle } from "@/combine/data";
import {
  fetchManifestPool,
  resolveGuestRecipes,
} from "@/combine/daily-schedule-db";
import {
  guestPoolFor,
  type DailyPayload,
} from "@/combine/daily-schedule";
import { dailySeed, todayKey } from "@/combine/rng";
import type { DailyConfig } from "@/combine/daily-config";
import {
  buildClusterManifest,
  buildManifestForDay,
  computeDifficulty,
  resolveManifestPool,
  UnreachableManifest,
  UnreachablePin,
} from "@/combine/manifest-solver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLUSTER_SAMPLER_MIN_POOL = 20;

/** Per-day edit of a scheduled daily payload. Lets an admin tweak one
 *  future day's guest ingredients and/or add extra manifest pins without
 *  regenerating the whole 30-day window.
 *
 *  Body: `{ guestOutputIds?: string[], extraPins?: string[] }`.
 *   - `guestOutputIds` (optional): replaces the day's guest list. Each
 *     id must be in the current guest pool for the active config's
 *     capped bundle — ids not in the pool are rejected.
 *   - `extraPins` (optional): added to the config's existing pins for
 *     this day only. Merged pins become the pin set the solver uses
 *     when rebuilding the manifest. Original config stays unchanged.
 *
 *  Rules:
 *   - 400 if `day` isn't `yyyy-mm-dd` or `day <= today` (today's row is
 *     reserved for `resetTodaySchedule`; past days are immutable).
 *   - 400 if no active daily or active config has no manifest (we need
 *     a solver pool to rebuild the manifest).
 *   - Seed stays stable: existing row's seed is preserved; if no row
 *     exists yet, we use `dailySeed(day)`.
 *   - Rebuilds manifest using rotation history from all prior rows
 *     strictly < `day`, matching schedule-builder semantics. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ day: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const { day } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "invalid_day" }, { status: 400 });
  }
  const today = todayKey();
  if (day < today) {
    return NextResponse.json(
      {
        error: "day_not_editable",
        message: "Past days are immutable — players have already seen them.",
      },
      { status: 400 },
    );
  }
  // day === today is allowed, but risky: in-progress runs still read the
  // row they started on and won't see the new guests/manifest until the
  // player refreshes. The UI surfaces a confirm step for this case; the
  // Reset today's daily button remains the harder-reset option that also
  // rerolls everything via `resetTodaySchedule`.

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const inputGuests = Array.isArray(body.guestOutputIds)
    ? (body.guestOutputIds as unknown[]).filter((x): x is string => typeof x === "string")
    : null;
  const inputExtraPins = Array.isArray(body.extraPins)
    ? (body.extraPins as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const active = await getActiveDaily();
  if (!active) {
    return NextResponse.json(
      { error: "no_active_daily", message: "No daily config is set." },
      { status: 400 },
    );
  }
  const { themeCode, config: dailyConfig } = active;

  const db = getDb();
  const [existingRow] = await db
    .select({ payload: schema.combineDailies.payload })
    .from(schema.combineDailies)
    .where(
      and(
        eq(schema.combineDailies.themeCode, themeCode),
        eq(schema.combineDailies.day, day),
      ),
    )
    .limit(1);
  const existing = existingRow ? (existingRow.payload as DailyPayload) : null;

  const { snapshot } = await getLiveSnapshot();
  const fullBundle = buildThemeBundle(snapshot, themeCode);
  const cappedBundle = buildThemeBundle(
    snapshot,
    themeCode,
    0,
    "daily",
    dailyConfig,
  );

  // Resolve the next guest list. If the admin didn't send guestOutputIds,
  // carry over whatever's currently on the row (or empty if no row yet).
  let nextGuests: string[];
  const invalidGuests: string[] = [];
  if (inputGuests !== null) {
    const pool = new Set(guestPoolFor(fullBundle, dailyConfig));
    nextGuests = [];
    for (const id of inputGuests) {
      if (pool.has(id)) nextGuests.push(id);
      else invalidGuests.push(id);
    }
    if (invalidGuests.length > 0) {
      return NextResponse.json(
        {
          error: "guests_not_in_pool",
          message: "One or more guest ids are not in the active config's guest pool.",
          invalid: invalidGuests,
        },
        { status: 400 },
      );
    }
  } else {
    nextGuests = existing?.guestOutputIds ?? [];
  }

  // Verify every chosen guest resolves to a buildable recipe in the
  // capped bundle. Unresolved ones get dropped silently for payload
  // integrity but are reported back so the admin can see which picks
  // didn't take.
  const { unresolved } = resolveGuestRecipes(
    fullBundle,
    cappedBundle,
    nextGuests,
  );
  const unresolvedSet = new Set(unresolved);
  const resolvedGuests = nextGuests.filter((id) => !unresolvedSet.has(id));

  // Rebuild the manifest. We require active.config.manifest here because
  // the solver needs a pool and size; without it the row's manifest would
  // be empty and the engine refuses to win. If the admin is running a
  // manifest-less daily (legacy), we skip the rebuild and reuse existing
  // manifest (likely empty).
  const extraPinSet = new Set(inputExtraPins);
  let manifest: string[] = existing?.manifest ?? [];
  let turnsToSolve: number | null = null;

  if (dailyConfig.manifest) {
    const mergedPins = [
      ...(dailyConfig.manifest.pins ?? []),
      ...[...extraPinSet].filter((p) => !(dailyConfig.manifest!.pins ?? []).includes(p)),
    ];
    const effectiveManifestConfig = {
      ...dailyConfig.manifest,
      pins: mergedPins,
    };

    const poolMembers = await fetchManifestPool(dailyConfig.manifest.pool);
    const resolvedPool = resolveManifestPool(poolMembers, cappedBundle);
    const difficulty = computeDifficulty(cappedBundle, themeCode);

    // Rotation history: every row strictly before this day contributes.
    const priorRowsRaw = await db
      .select({
        day: schema.combineDailies.day,
        payload: schema.combineDailies.payload,
      })
      .from(schema.combineDailies)
      .where(eq(schema.combineDailies.themeCode, themeCode));
    const history = new Map<string, string>();
    const sortedPrior = priorRowsRaw
      .map((r) => ({ day: r.day, payload: r.payload as DailyPayload }))
      .filter((r) => r.day < day)
      .sort((a, b) => a.day.localeCompare(b.day));
    for (const row of sortedPrior) {
      for (const id of row.payload.manifest ?? []) history.set(id, row.day);
    }
    const rotation = new Map<string, number>();
    const target = new Date(`${day}T00:00:00Z`).getTime();
    for (const [id, served] of history) {
      const t = new Date(`${served}T00:00:00Z`).getTime();
      const delta = Math.round((target - t) / 86_400_000);
      if (delta >= 0) rotation.set(id, delta);
    }

    try {
      const useCluster = resolvedPool.length >= CLUSTER_SAMPLER_MIN_POOL;
      const build = useCluster
        ? buildClusterManifest({
            cappedBundle,
            theme: themeCode,
            config: effectiveManifestConfig,
            day,
            pool: resolvedPool,
            rotation,
            difficulty,
          })
        : buildManifestForDay({
            cappedBundle,
            theme: themeCode,
            config: effectiveManifestConfig,
            day,
            pool: resolvedPool,
            rotation,
            difficulty,
          });
      manifest = build.manifest;
      turnsToSolve = build.turnsToSolve;
    } catch (err) {
      if (err instanceof UnreachablePin) {
        return NextResponse.json(
          {
            error: "unreachable_pin",
            pin: err.pin,
            message: err.message,
          },
          { status: 400 },
        );
      }
      if (err instanceof UnreachableManifest) {
        return NextResponse.json(
          {
            error: "unreachable_manifest",
            manifest: err.manifest,
            breakers: err.breakers ?? null,
            message: err.message,
          },
          { status: 400 },
        );
      }
      throw err;
    }
  }

  // Freeze an updated per-day config so the saved payload records the
  // extra pins the admin added — future reads see what actually drove
  // the manifest for this day. Only mutate if there are extras.
  const frozenConfig: DailyConfig =
    extraPinSet.size > 0 && dailyConfig.manifest
      ? {
          ...dailyConfig,
          manifest: {
            ...dailyConfig.manifest,
            pins: [
              ...(dailyConfig.manifest.pins ?? []),
              ...[...extraPinSet].filter(
                (p) => !(dailyConfig.manifest!.pins ?? []).includes(p),
              ),
            ],
          },
        }
      : dailyConfig;

  const payload: DailyPayload = {
    version: 1,
    config: frozenConfig,
    guestOutputIds: resolvedGuests,
    seed: existing?.seed ?? dailySeed(day),
    manifest,
    generatedAt: new Date().toISOString(),
  };

  await db
    .insert(schema.combineDailies)
    .values({ themeCode, day, payload })
    .onConflictDoUpdate({
      target: [schema.combineDailies.themeCode, schema.combineDailies.day],
      set: { payload },
    });

  return NextResponse.json({
    ok: true,
    themeCode,
    day,
    payload,
    unresolvedGuests: unresolved,
    turnsToSolve,
  });
}
