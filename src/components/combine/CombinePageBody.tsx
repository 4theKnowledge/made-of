import { eq } from "drizzle-orm";
import { getLiveSnapshot } from "@/graph/live";
import { Footer } from "@/components/common/Footer";
import { Header } from "@/components/common/Header";
import {
  buildAllBundles,
  buildAllDailyBundles,
  buildAllFastBundles,
} from "@/combine/data";
import type { DailyConfig } from "@/combine/daily-config";
import type { ThemeKey } from "@/combine/types";
import { serialiseBundle } from "@/combine/serialise";
import { loadAllSeasons, promoteSeason } from "@/combine/season";
import { CombineBoard } from "@/components/combine/CombineBoard";
import { getDb, schema } from "@/db/client";
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
  const dailyBundles = buildAllDailyBundles(live.snapshot, prev, dailyConfigs);

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
