import type { Metadata } from "next";
import { Footer } from "@/components/common/Footer";
import { Header } from "@/components/common/Header";
import { getLiveSnapshot } from "@/graph/live";
import {
  bestRecipe,
  canMakeNow,
  costs,
  missing,
  parFor,
  recipesOf,
  viewOf,
} from "@/graph/craft";
import { CraftBoard } from "@/components/craft/CraftBoard";
import type {
  ScratchItemFull,
  ScratchStateResponse,
} from "@/components/craft/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Craft · Made Of",
  description:
    "A crafting game: build up to a target item by combining what you've already made, starting from the big bang.",
  alternates: { canonical: "/craft" },
};

const DEFAULT_TARGET = "pencil";
const ORIGIN = "big-bang";

export default async function CraftPage() {
  const live = await getLiveSnapshot();

  // Pick an initial target. We default to pencil (prototype default); if it
  // doesn't exist in live content, fall back to any easy pickable item.
  const targetNode =
    live.snapshot.nodes.get(DEFAULT_TARGET) ??
    [...live.snapshot.nodes.values()].find(
      (n) => n.recipes.length > 0 && n.tier !== "F",
    );
  if (!targetNode) {
    throw new Error("No scratch target available");
  }
  const targetCode = live.itemCodes.toCode(targetNode.id)!;

  const have = new Set<string>([ORIGIN]);
  const c = costs(live.snapshot, have);
  const miss = missing(live.snapshot, targetNode.id, have, c);

  const readyItems: ScratchItemFull[] = [];
  for (const n of live.snapshot.nodes.values()) {
    if (canMakeNow(n, have)) {
      const code = live.itemCodes.toCode(n.id);
      if (code) readyItems.push(viewOf(n, code));
    }
  }

  const targetRecipes = recipesOf(targetNode).map((r) => ({
    id: r.id,
    label: r.label,
    position: r.position,
    requires: r.requires
      .map((slug) => {
        const n = live.snapshot.nodes.get(slug);
        const code = live.itemCodes.toCode(slug);
        if (!n || !code) return null;
        return {
          slug,
          code,
          name: n.name,
          tier: n.tier,
          kind: n.kind,
          symbol: n.symbol,
          have: have.has(slug),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  }));

  const initial: ScratchStateResponse = {
    target: viewOf(targetNode, targetCode),
    targetRecipes,
    bestRecipeIndex: bestRecipe(targetNode, c),
    par: parFor(live.snapshot, targetNode.id),
    ready: readyItems,
    missing: miss.size,
    won: false,
  };

  return (
    <main
      className="wrap"
      style={
        {
          "--c": `var(--t${targetNode.tier})`,
        } as React.CSSProperties
      }
    >
      <Header
        current="craft"
        exploreHref={`/explore/${targetNode.id}`}
      />

      <CraftBoard initial={initial} />
      <Footer compactOnMobile />
    </main>
  );
}
