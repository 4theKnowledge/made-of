import { eq } from "drizzle-orm";
import { getLiveSnapshot } from "@/graph/live";
import { Footer } from "@/components/common/Footer";
import { Header } from "@/components/common/Header";
import {
  buildAllBundles,
  buildAllDailyBundles,
  buildAllFastBundles,
  buildThemeBundle,
  type GuestRecipeExtension,
} from "@/combine/data";
import type { DailyConfig } from "@/combine/daily-config";
import type { ThemeKey } from "@/combine/types";
import { serialiseBundle } from "@/combine/serialise";
import { loadAllSeasons, promoteSeason } from "@/combine/season";
import { CombineBoard } from "@/components/combine/CombineBoard";
import { getDb, schema } from "@/db/client";
import { getDailyPayload, resolveGuestRecipes } from "@/combine/daily-schedule-db";
import { todayKey } from "@/combine/rng";
import { getSession, isAdmin } from "@/lib/session";

export async function CombinePageBody() {
  const live = await getLiveSnapshot();
  const prev = await loadAllSeasons();
  const bundles = buildAllBundles(live.snapshot, prev);
  // Promote any theme whose derived numAges exceeded its stored value. Fire
  // and forget — we don't need to block the first render on the write.
  for (const [theme, bundle] of Object.entries(bundles)) {
    const curr = bundle.theme.ages.length;
    if (curr > (prev[theme as keyof typeof prev] ?? 0)) {
      void promoteSeason(theme as keyof typeof prev, curr);
    }
  }
  const fastBundles = buildAllFastBundles(live.snapshot);

  // Load per-theme dailyConfig from the DB. A theme without one shares its
  // endless bundle for daily play. Only the keys we actually use are read.
  const db = getDb();
  const everythingRow = await db
    .select({ dailyConfig: schema.combineThemes.dailyConfig })
    .from(schema.combineThemes)
    .where(eq(schema.combineThemes.code, "everything"))
    .limit(1);
  const dailyConfigs: Partial<Record<ThemeKey, DailyConfig | null>> = {
    everything: (everythingRow[0]?.dailyConfig ?? null) as DailyConfig | null,
  };

  // Resolve today's guest recipes from the precomputed schedule. A missing
  // row (first-time setup, cron hasn't run yet) falls back to zero guests —
  // the daily still plays, just without rare-item drip.
  const today = todayKey();
  const guestRecipes: Partial<Record<ThemeKey, GuestRecipeExtension[] | null>> = {};
  if (dailyConfigs.everything) {
    const payload = await getDailyPayload("everything", today);
    if (payload && payload.guestOutputIds.length > 0) {
      // We need both the full and capped bundles to resolve guest recipes.
      const fullEverything = buildThemeBundle(live.snapshot, "everything", prev.everything ?? 0);
      const cappedEverything = buildThemeBundle(
        live.snapshot,
        "everything",
        prev.everything ?? 0,
        "daily",
        dailyConfigs.everything,
      );
      const { extensions } = resolveGuestRecipes(
        fullEverything,
        cappedEverything,
        payload.guestOutputIds,
      );
      guestRecipes.everything = extensions;
    }
  }
  const dailyBundles = buildAllDailyBundles(
    live.snapshot,
    prev,
    dailyConfigs,
    guestRecipes,
  );

  const serialised = {
    everything: serialiseBundle(bundles.everything),
  };
  const fastSerialised = {
    everything: serialiseBundle(fastBundles.everything),
  };
  const dailySerialised = {
    everything: serialiseBundle(dailyBundles.everything),
  };
  const admin = await isAdmin();
  const session = await getSession();
  const signedIn = !!session?.user?.id;

  return (
    <main className="wrap">
      <Header current="combine" />
      <CombineBoard
        bundles={serialised}
        fastBundles={fastSerialised}
        dailyBundles={dailySerialised}
        admin={admin}
        signedIn={signedIn}
      />
      <Footer compactOnMobile />
    </main>
  );
}
