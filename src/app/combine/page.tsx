import type { Metadata } from "next";
import { getLiveSnapshot } from "@/graph/live";
import { Footer } from "@/components/common/Footer";
import { Header } from "@/components/common/Header";
import { buildAllBundles } from "@/combine/data";
import { serialiseBundle } from "@/combine/serialise";
import { CombineBoard } from "@/components/combine/CombineBoard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Combine · Made Of",
  description:
    "A tile-combining puzzle. Place touching things that make something, and watch recipes chain into one another.",
  alternates: { canonical: "/combine" },
};

export default async function CombinePage() {
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
