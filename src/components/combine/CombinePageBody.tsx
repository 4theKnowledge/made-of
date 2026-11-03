import { getLiveSnapshot } from "@/graph/live";
import { Footer } from "@/components/common/Footer";
import { Header } from "@/components/common/Header";
import { buildAllBundles } from "@/combine/data";
import { serialiseBundle } from "@/combine/serialise";
import { loadAllSeasons, promoteSeason } from "@/combine/season";
import { CombineBoard } from "@/components/combine/CombineBoard";
import { isAdmin } from "@/lib/session";

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
  const serialised = {
    everything: serialiseBundle(bundles.everything),
  };
  const admin = await isAdmin();

  return (
    <main className="wrap">
      <Header current="combine" />
      <CombineBoard bundles={serialised} admin={admin} />
      <Footer compactOnMobile />
    </main>
  );
}
