import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import {
  HeroChain,
  type Tree,
  type TreeBranch,
  type TreeItem,
} from "@/components/home/HeroChain";
import { ModeGrid } from "@/components/home/ModeGrid";
import { getLiveSnapshot } from "@/graph/live";

export const dynamic = "force-dynamic";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Made Of — what anything is made of",
  description:
    "A shirt needs thread, thread needs cotton, cotton needs a plant, and the plant needs sunlight from a star. Made Of maps those connections for thousands of things.",
  alternates: { canonical: "/" },
};

/**
 * Tree definitions. Each converging tree shows multiple raw inputs becoming
 * intermediates that become one final item. Every edge below is a verified
 * `f` (made-from) relation in the seed data — if a slug drifts, the tree
 * is dropped at render time so the hero never breaks.
 *
 * Branches use `null` for `raw` when the mid-level item should be shown
 * as a leaf (e.g. water in lemonade).
 */
const TREE_DEFS: ReadonlyArray<{
  id: string;
  finalSlug: string;
  branches: Array<{ rawSlug: string | null; midSlug: string }>;
}> = [
  {
    id: "chocolate",
    finalSlug: "chocolate",
    branches: [
      { rawSlug: "cacao-tree", midSlug: "cocoa" },
      { rawSlug: "sugarcane", midSlug: "sugar" },
      { rawSlug: "cow", midSlug: "milk" },
    ],
  },
  {
    id: "pancake",
    finalSlug: "pancake",
    branches: [
      { rawSlug: "wheat", midSlug: "flour" },
      { rawSlug: "chicken", midSlug: "egg" },
      { rawSlug: "cow", midSlug: "milk" },
    ],
  },
  {
    id: "lemonade",
    finalSlug: "lemonade",
    branches: [
      { rawSlug: "lemon-tree", midSlug: "lemon" },
      { rawSlug: "sugarcane", midSlug: "sugar" },
      { rawSlug: null, midSlug: "water" },
    ],
  },
];

export default async function HomePage() {
  const live = await getLiveSnapshot();

  const toTreeItem = (slug: string): TreeItem | null => {
    const node = live.snapshot.bySlug.get(slug);
    if (!node) return null;
    return {
      slug: node.slug,
      name: node.name,
      tier: node.tier,
      kind: node.kind,
      symbol: node.symbol,
      pictogram: node.pictogram,
    };
  };

  const trees: Tree[] = [];
  for (const def of TREE_DEFS) {
    const final = toTreeItem(def.finalSlug);
    if (!final) continue;
    const branches: TreeBranch[] = [];
    let complete = true;
    for (const b of def.branches) {
      const mid = toTreeItem(b.midSlug);
      if (!mid) {
        complete = false;
        break;
      }
      const raw = b.rawSlug ? toTreeItem(b.rawSlug) : null;
      if (b.rawSlug && !raw) {
        complete = false;
        break;
      }
      branches.push({ raw, mid });
    }
    if (complete) {
      trees.push({ id: def.id, endSlug: def.finalSlug, branches, final });
    }
  }

  // The secondary CTA deep-links into the first tree's final item so the
  // user lands on something they just saw. Falls back to /explore/water.
  const exploreTarget = trees[0]?.endSlug ?? "water";

  return (
    <main className="wrap">
      <Header current="home" />

      <section className="homeHero">
        <span className="eyebrow">Made Of</span>
        <h1>Everything is made of something.</h1>
        <p>
          A shirt needs thread, thread needs cotton, cotton needs a plant, and
          the plant needs sunlight from a star. Made Of maps those connections,
          from the big bang to the internet.
        </p>

        {trees.length > 0 && <HeroChain trees={trees} />}

        <div className="homeCtas">
          <Link href="/combine" className="btn primary">
            Play today’s Combine
          </Link>
          <Link href={`/explore/${exploreTarget}`} className="btn">
            Explore the map
          </Link>
        </div>
      </section>

      <ModeGrid />

      <Footer />
    </main>
  );
}
