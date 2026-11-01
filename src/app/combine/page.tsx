import type { Metadata } from "next";
import Link from "next/link";
import { getLiveSnapshot } from "@/graph/live";
import { Footer } from "@/components/common/Footer";
import { AuthNavLink } from "@/components/common/AuthNavLink";
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
      <header>
        <div className="brand">
          <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
            <h1>Made Of</h1>
          </Link>
          <span>Everything is made of something.</span>
        </div>
        <nav className="tabs" aria-label="Modes">
          <Link href="/">Daily link</Link>
          <Link href="/explore/water">Explore</Link>
          <Link href="/scratch">From scratch</Link>
          <Link href="/combine" className="on">
            Combine
          </Link>
          <AuthNavLink />
        </nav>
      </header>

      <CombineBoard bundles={serialised} />
      <Footer />
    </main>
  );
}
