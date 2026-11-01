import { getLiveSnapshot } from "@/graph/live";
import { Footer } from "@/components/common/Footer";
import { Header } from "@/components/common/Header";
import { buildAllBundles } from "@/combine/data";
import { serialiseBundle } from "@/combine/serialise";
import { CombineBoard } from "@/components/combine/CombineBoard";

export async function CombinePageBody() {
  const live = await getLiveSnapshot();
  const bundles = buildAllBundles(live.snapshot);
  const serialised = {
    everyday: serialiseBundle(bundles.everyday),
    everything: serialiseBundle(bundles.everything),
  };

  return (
    <main className="wrap">
      <Header current="combine" />
      <CombineBoard bundles={serialised} />
      <Footer compactOnMobile />
    </main>
  );
}
