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

const DEFAULT_TARGET_SLUG = "pencil";
const ORIGIN_SLUG = "big-bang";

export default async function CraftPage() {
  const live = await getLiveSnapshot();

  // Pick an initial target. We default to pencil (prototype default); if it
  // doesn't exist in live content, fall back to any easy pickable item.
  const targetNode =
    live.snapshot.bySlug.get(DEFAULT_TARGET_SLUG) ??
    [...live.snapshot.nodes.values()].find(
      (n) => n.recipes.length > 0 && n.tier !== "F",
    );
  if (!targetNode) {
    throw new Error("No scratch target available");
  }
  const targetCode = live.itemCodes.toCode(targetNode.slug)!;

  const originNode = live.snapshot.bySlug.get(ORIGIN_SLUG);
  const have = new Set<string>();
  if (originNode) have.add(originNode.id);
  const c = costs(live.snapshot, have);
  const miss = missing(live.snapshot, targetNode.id, have, c);

  const readyItems: ScratchItemFull[] = [];
  for (const n of live.snapshot.nodes.values()) {
    if (canMakeNow(n, have)) {
      const code = live.itemCodes.toCode(n.slug);
      if (code) readyItems.push(viewOf(n, code));
    }
  }

  const targetRecipes = recipesOf(targetNode).map((r) => ({
    id: r.id,
    label: r.label,
    position: r.position,
    requires: r.requires
      .map((id) => {
        const n = live.snapshot.nodes.get(id);
        if (!n) return null;
        const code = live.itemCodes.toCode(n.slug);
        if (!code) return null;
        return {
          slug: n.slug,
          code,
          name: n.name,
          tier: n.tier,
          kind: n.kind,
          symbol: n.symbol,
          have: have.has(id),
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
        exploreHref={`/explore/${targetNode.slug}`}
      />

      <CraftBoard initial={initial} />
      <Footer compactOnMobile />
    </main>
  );
}
