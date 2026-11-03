import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import { getLiveSnapshot } from "@/graph/live";
import { buildThemeBundle } from "@/combine/data";
import { computeRefine } from "@/combine/levels";
import { loadSeason } from "@/combine/season";
import type { ThemeKey } from "@/combine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/combine/bands?theme=everything — diagnostic for Combine's
 *  age layout on live data. Reports what buildThemeBundle produces against
 *  the live snapshot: recipe counts per band, derived vs. effective numAges,
 *  refinement-level histogram, and a few sample outputs per band. Lets us
 *  diagnose "why does prod collapse to 1 age" without exporting prod DB
 *  credentials. */
export async function GET(req: Request) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const url = new URL(req.url);
  const theme = (url.searchParams.get("theme") ?? "everything") as ThemeKey;
  const live = await getLiveSnapshot();
  const prevNumAges = await loadSeason(theme);
  const bundle = buildThemeBundle(live.snapshot, theme, prevNumAges);
  const refine = computeRefine(live.snapshot);

  const sizes = new Map<number, number>();
  for (const r of bundle.recipes) sizes.set(r.band, (sizes.get(r.band) ?? 0) + 1);

  const samples: Record<number, string[]> = {};
  for (const r of bundle.recipes) {
    const list = (samples[r.band] = samples[r.band] ?? []);
    if (list.length < 8) {
      const item = bundle.items.get(r.out);
      if (item) list.push(item.name);
    }
  }

  const levelHist = new Map<number, number>();
  for (const r of bundle.recipes) {
    levelHist.set(r.lvl, (levelHist.get(r.lvl) ?? 0) + 1);
  }
  const sortedLevels = [...levelHist.keys()].sort((a, b) => a - b);

  // Refine distribution over theme items: how many unique refine levels do
  // theme outputs occupy? If this is 1 or 2, assignAges can't carve bands.
  const refineHist = new Map<number, number>();
  for (const id of bundle.outputs) {
    const v = refine.get(id) ?? 0;
    refineHist.set(v, (refineHist.get(v) ?? 0) + 1);
  }

  return NextResponse.json({
    theme,
    prevNumAges,
    effectiveAges: bundle.theme.ages.length,
    ageNames: bundle.theme.ages,
    recipes: bundle.recipes.length,
    outputs: bundle.outputs.size,
    base: bundle.base.length,
    bandSizes: Object.fromEntries(
      [...sizes.entries()].sort(([a], [b]) => a - b),
    ),
    bandSamples: samples,
    recipeLevelHistogram: Object.fromEntries(
      sortedLevels.map((l) => [l, levelHist.get(l)]),
    ),
    outputRefineHistogram: Object.fromEntries(
      [...refineHist.entries()].sort(([a], [b]) => a - b),
    ),
    snapshotVersion: live.version,
  });
}
