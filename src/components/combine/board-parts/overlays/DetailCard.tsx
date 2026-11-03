import React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";

export function DetailCard({
  tileId,
  bundle,
  known,
  howMade,
  onDismiss,
}: {
  tileId: string;
  bundle: ThemeBundle;
  /** Everything the player knows (this game + lifetime collection). */
  known: Set<string>;
  /** Ingredients the player actually used to make each output this run.
   *  When present for `tileId`, it wins over the bundle's canonical recipe
   *  so items with multiple valid recipes show the one the player made. */
  howMade: Record<string, string[]>;
  onDismiss: () => void;
}) {
  const item = bundle.items.get(tileId);
  if (!item) return null;
  // Only reveal a recipe the player has earned the right to see — either
  // because they made it this run, or because the output is already known
  // (previous run, lifetime collection, or raw starting item). Otherwise
  // hide ingredients so long-pressing a tile can't be used to peek at how
  // to craft an undiscovered item.
  const playerRecipe = howMade[tileId];
  const isKnown = known.has(tileId);
  const bundleRecipe = isKnown
    ? bundle.recipes.find((r) => r.out === tileId)
    : undefined;
  const loreRecipe = isKnown && item.lore ? { all: item.lore } : null;
  const madeFrom: { all: string[] } | null = playerRecipe
    ? { all: playerRecipe }
    : (bundleRecipe ?? loreRecipe);
  // Goes into: recipes that use this tile as an ingredient.
  const goesInto = (bundle.byIngredient.get(tileId) ?? []).filter(
    (r) => r.out !== tileId,
  );
  const foundGoesInto = goesInto.filter((r) => known.has(r.out));
  const unfoundCount = goesInto.length - foundGoesInto.length;
  return (
    <ResponsiveSheet
      open
      onDismiss={onDismiss}
      ariaLabel={cap(item.name)}
      className="cbinfo"
    >
      <div className="cbinfohd" style={fillVar(item)}>
          <Pictogram
            name={item.name}
            tier={item.tier}
            kind={item.kind}
            symbol={item.symbol}
          />
        </div>
        <div className="nm">{cap(item.name)}</div>
        {madeFrom ? (
          <div className="cbrcp" aria-label="Made from">
            {madeFrom.all.map((pid, k) => {
              const p = bundle.items.get(pid);
              if (!p) return null;
              return (
                <span key={pid}>
                  <Pictogram
                    name={p.name}
                    tier={p.tier}
                    kind={p.kind}
                    symbol={p.symbol}
                  />
                  {cap(p.name)}
                  {k < madeFrom.all.length - 1 && <i>+</i>}
                </span>
              );
            })}
            <i>=</i>
            <span>{cap(item.name)}</span>
          </div>
        ) : isKnown ? (
          <p className="fact">A raw thing.</p>
        ) : (
          <p className="fact">You haven&rsquo;t made this yet.</p>
        )}
        {item.fact && <p className="fact">{item.fact}</p>}
        {goesInto.length > 0 && (
          <div
            className="cbrcp"
            aria-label="Goes into"
            style={{ marginTop: 4 }}
          >
            <b style={{ marginRight: 6 }}>Goes into:</b>
            {foundGoesInto.slice(0, 6).map((r) => {
              const o = bundle.items.get(r.out);
              if (!o) return null;
              return (
                <span key={r.out}>
                  <Pictogram
                    name={o.name}
                    tier={o.tier}
                    kind={o.kind}
                    symbol={o.symbol}
                  />
                  {cap(o.name)}
                </span>
              );
            })}
            {unfoundCount > 0 && (
              <span className="q">+{unfoundCount} to discover</span>
            )}
          </div>
        )}
        <div className="row2">
          <a
            className="cbh"
            href={`/explore/${item.slug}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Full story in Explore
          </a>
          <button type="button" className="cbh" onClick={onDismiss}>
            Back to the game
          </button>
        </div>
    </ResponsiveSheet>
  );
}
