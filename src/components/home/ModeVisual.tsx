import { Pictogram } from "@/pictograms/Pictogram";
import type { ItemKind, Tier } from "@/db/schema";
import type { GraphNode } from "@/graph/types";

interface Mini {
  slug: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  symbol: string | null;
  pictogram: string | null;
}

function toMini(node: GraphNode | undefined): Mini | null {
  if (!node) return null;
  return {
    slug: node.slug,
    name: node.name,
    tier: node.tier,
    kind: node.kind,
    symbol: node.symbol,
    pictogram: node.pictogram,
  };
}

/** Small bordered pictogram tile used inside the card visuals. No label —
 *  the card's title and copy already explain what the visual is. Kept
 *  tight so the visual accents the card rather than dominates it. */
function MiniTile({ item, size = 36 }: { item: Mini; size?: number }) {
  return (
    <span
      className="modeViz-ptile"
      style={{
        "--fill": `var(--f${item.tier})`,
        width: size,
        height: size,
      } as React.CSSProperties}
      title={item.name}
    >
      <Pictogram
        name={item.name}
        tier={item.tier}
        kind={item.kind}
        symbol={item.symbol}
        pictogram={item.pictogram}
        size={size}
      />
    </span>
  );
}

/**
 * Visual for the Combine card. Shows the core mechanic in one glance:
 * two touching tiles merge into a third (rock + water = clay — a real
 * recipe from the DB).
 */
export function CombineVisual({
  items,
}: {
  items: { rock: GraphNode | undefined; water: GraphNode | undefined; clay: GraphNode | undefined };
}) {
  const a = toMini(items.rock);
  const b = toMini(items.water);
  const c = toMini(items.clay);
  if (!a || !b || !c) return null;
  return (
    <div className="modeViz modeViz-combine" aria-hidden="true">
      <MiniTile item={a} />
      <span className="modeViz-op">+</span>
      <MiniTile item={b} />
      <span className="modeViz-op">=</span>
      <MiniTile item={c} />
    </div>
  );
}

/**
 * Visual for the Explore card. A micro-bowtie: two inputs feed into a
 * centre item, which feeds out to one next item. Uses flour + water →
 * bread → sandwich (all real f-links in the DB).
 */
export function ExploreVisual({
  items,
}: {
  items: {
    flour: GraphNode | undefined;
    water: GraphNode | undefined;
    bread: GraphNode | undefined;
    sandwich: GraphNode | undefined;
  };
}) {
  const a = toMini(items.flour);
  const b = toMini(items.water);
  const c = toMini(items.bread);
  const d = toMini(items.sandwich);
  if (!a || !b || !c || !d) return null;
  return (
    <div className="modeViz modeViz-explore" aria-hidden="true">
      <div className="modeViz-col">
        <MiniTile item={a} size={32} />
        <MiniTile item={b} size={32} />
      </div>
      <svg
        className="modeViz-wires"
        viewBox="0 0 24 72"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line x1="0" y1="16" x2="24" y2="36" />
        <line x1="0" y1="56" x2="24" y2="36" />
      </svg>
      <div className="modeViz-centre">
        <MiniTile item={c} size={32} />
      </div>
      <svg
        className="modeViz-wires modeViz-wires-out"
        viewBox="0 0 24 72"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line x1="0" y1="36" x2="24" y2="36" />
      </svg>
      <div className="modeViz-col">
        <MiniTile item={d} size={32} />
      </div>
    </div>
  );
}
