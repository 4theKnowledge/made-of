import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { requireAdminApi } from "@/lib/admin";
import { getActiveDaily } from "@/combine/daily-config-db";
import { buildThemeBundle } from "@/combine/data";
import { fetchManifestPool } from "@/combine/daily-schedule-db";
import {
  buildClusterManifest,
  buildManifestForDay,
  computeDifficulty,
  poolStats,
  resolveManifestPool,
  UnreachablePin,
  UnreachableManifest,
} from "@/combine/manifest-solver";

/** Must match CLUSTER_SAMPLER_MIN_POOL in daily-schedule-db.ts so the
 *  preview mirrors what the actual schedule build will do. */
const CLUSTER_SAMPLER_MIN_POOL = 20;
import { todayKey } from "@/combine/rng";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Preview the manifest the solver would produce for a given day (T-0242).
 *
 *  GET /api/admin/combine/daily/preview-manifest?day=YYYY-MM-DD
 *
 *  Returns `{ pinned, generated, turnsToSolve }` on success. On solver
 *  failure (unreachable pin / unsolvable manifest / missing config),
 *  returns an `{ error }` with 400/500 so the admin UI can surface a
 *  banner and suggested fix.
 *
 *  Pure read: never writes to `combine_dailies`. The admin can hit this
 *  at any time to sanity-check the current pool + pins without touching
 *  the schedule. */
export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const day = req.nextUrl.searchParams.get("day") ?? todayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "invalid_day" }, { status: 400 });
  }

  const active = await getActiveDaily();
  if (!active || !active.config.manifest) {
    return NextResponse.json(
      {
        error: "no_manifest_config",
        message: "Set DailyConfig.manifest first.",
      },
      { status: 400 },
    );
  }

  const { snapshot } = await getLiveSnapshot();
  const cappedBundle = buildThemeBundle(
    snapshot,
    active.themeCode,
    0,
    "daily",
    active.config,
  );

  const poolMembers = await fetchManifestPool(active.config.manifest.pool);
  const pool = resolveManifestPool(poolMembers, cappedBundle);

  // Precompute per-item difficulty and summarise the pool. The admin UI
  // renders this even when the preview itself succeeds — it's a health
  // check on the pool, not a failure indicator.
  const difficulty = computeDifficulty(cappedBundle, active.themeCode);
  const stats = poolStats(pool, difficulty);

  const useClusterSampler = pool.length >= CLUSTER_SAMPLER_MIN_POOL;
  try {
    const build = useClusterSampler
      ? buildClusterManifest({
          cappedBundle,
          theme: active.themeCode,
          config: active.config.manifest,
          day,
          pool,
          rotation: new Map(),
          difficulty,
        })
      : buildManifestForDay({
          cappedBundle,
          theme: active.themeCode,
          config: active.config.manifest,
          day,
          pool,
          rotation: new Map(),
          difficulty,
        });
    const { manifest, turnsToSolve } = build;
    const clusters = "clusters" in build ? build.clusters : null;
    const pinned = active.config.manifest.pins ?? [];
    const pinnedSet = new Set(pinned);
    const generated = manifest.filter((id) => !pinnedSet.has(id));
    return NextResponse.json({
      day,
      themeCode: active.themeCode,
      poolSize: pool.length,
      pinned,
      generated,
      manifest,
      turnsToSolve,
      poolStats: stats,
      clusters,
      sampler: useClusterSampler ? "cluster" : "single",
    });
  } catch (err) {
    if (err instanceof UnreachablePin) {
      return NextResponse.json(
        {
          error: "unreachable_pin",
          pin: err.pin,
          message: err.message,
          poolStats: stats,
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
          poolStats: stats,
        },
        { status: 400 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "preview_failed", message: msg }, { status: 500 });
  }
}
