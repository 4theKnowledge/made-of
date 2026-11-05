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
import { getActiveDaily } from "@/combine/daily-config-db";
import type { ThemeKey } from "@/combine/types";
import { serialiseBundle } from "@/combine/serialise";
import { loadAllSeasons, promoteSeason } from "@/combine/season";
import { CombineBoard } from "@/components/combine/CombineBoard";
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

  // Load the singleton daily config. If none is set, daily plays with the
  // same shape as endless (no cap, no guests). The active theme drives
  // which per-theme bundle receives the daily knobs.
  const activeDaily = await getActiveDaily();
  const dailyConfigs: Partial<Record<ThemeKey, DailyConfig | null>> = {};
  if (activeDaily) {
    dailyConfigs[activeDaily.themeCode] = activeDaily.config;
  }

  // Resolve today's guest recipes from the precomputed schedule. A missing
  // row (first-time setup, cron hasn't run yet) falls back to zero guests —
  // the daily still plays, just without rare-item drip.
  const today = todayKey();
  const guestRecipes: Partial<Record<ThemeKey, GuestRecipeExtension[] | null>> = {};
  if (activeDaily) {
    const payload = await getDailyPayload(activeDaily.themeCode, today);
    if (payload && payload.guestOutputIds.length > 0) {
      const fullThemeBundle = buildThemeBundle(
        live.snapshot,
        activeDaily.themeCode,
        prev[activeDaily.themeCode] ?? 0,
      );
      const cappedThemeBundle = buildThemeBundle(
        live.snapshot,
        activeDaily.themeCode,
        prev[activeDaily.themeCode] ?? 0,
        "daily",
        activeDaily.config,
      );
      const { extensions } = resolveGuestRecipes(
        fullThemeBundle,
        cappedThemeBundle,
        payload.guestOutputIds,
      );
      guestRecipes[activeDaily.themeCode] = extensions;
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
