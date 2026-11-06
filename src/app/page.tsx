import type { Metadata } from "next";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import {
  HeroChain,
  type ChainStage,
  type TreeItem,
} from "@/components/home/HeroChain";
import { ModeGrid } from "@/components/home/ModeGrid";
import {
  CombineVisual,
  ExploreVisual,
} from "@/components/home/ModeVisual";
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
 * The epic chain: big bang → smartphone, as a six-stage sequence. Each stage
 * converges a handful of real inputs into one final item; stages 3–6 carry
 * the previous stage's final as their first input so the whole thing reads
 * as one pipeline from the first atoms to a modern phone.
 *
 * Every edge below is a verified `f` (made-from) relation in the seed data —
 * if any slug drifts the stage is dropped and we fall back gracefully.
 */
const CHAIN_DEFS: ReadonlyArray<{
  id: string;
  era?: string;
  finalSlug: string;
  inputSlugs: string[];
}> = [
  {
    id: "first-atoms",
    era: "13.8 bya · the first atoms",
    finalSlug: "star",
    inputSlugs: ["hydrogen", "helium"],
  },
  {
    id: "stardust",
    era: "stars forge the elements",
    finalSlug: "rock",
    inputSlugs: ["silicon", "oxygen", "iron"],
  },
  {
    id: "earth",
    era: "a cooling planet",
    finalSlug: "sand",
    inputSlugs: ["rock", "quartz", "water"],
  },
  {
    id: "glassmaking",
    era: "~3500 bce · the first glass",
    finalSlug: "glass",
    inputSlugs: ["sand", "soda-ash", "limestone"],
  },
  {
    id: "screen",
    era: "the modern display",
    finalSlug: "screen",
    inputSlugs: ["glass", "plastic", "copper-wire"],
  },
  {
    id: "phone",
    era: "and finally…",
    finalSlug: "smartphone",
    inputSlugs: ["screen", "microchip", "battery"],
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

  const stages: ChainStage[] = [];
  for (const def of CHAIN_DEFS) {
    const final = toTreeItem(def.finalSlug);
    if (!final) continue;
    const inputs: TreeItem[] = [];
    let complete = true;
    for (const slug of def.inputSlugs) {
      const t = toTreeItem(slug);
      if (!t) {
        complete = false;
        break;
      }
      inputs.push(t);
    }
    if (complete) {
      stages.push({
        id: def.id,
        era: def.era,
        inputs,
        final,
      });
    }
  }

  return (
    <main className="wrap">
      <Header current="home" />

      <section className="homeHero">
        <h1>
          Everything is <span className="homeHero-mark">made of</span>{" "}
          something.
        </h1>
        <p>
          A shirt needs thread, thread needs cotton, cotton needs a plant, and
          the plant needs sunlight from a star. Made Of maps those connections,
          from the big bang to the internet.
        </p>

        {stages.length > 0 && <HeroChain stages={stages} />}
      </section>

      <ModeGrid
        combineVisual={
          <CombineVisual
            items={{
              rock: live.snapshot.bySlug.get("rock"),
              water: live.snapshot.bySlug.get("water"),
              clay: live.snapshot.bySlug.get("clay"),
            }}
          />
        }
        exploreVisual={
          <ExploreVisual
            items={{
              flour: live.snapshot.bySlug.get("flour"),
              water: live.snapshot.bySlug.get("water"),
              bread: live.snapshot.bySlug.get("bread"),
              sandwich: live.snapshot.bySlug.get("sandwich"),
            }}
          />
        }
      />

      <Footer />
    </main>
  );
}
