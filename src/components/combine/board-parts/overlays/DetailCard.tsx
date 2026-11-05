import React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { ThemeBundle } from "@/combine/types";
import { cap, KIND } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";
import { ButtonGroup } from "@/components/common/ButtonGroup";
import type { MasteryInfo } from "@/components/combine/board-parts/types";

export function DetailCard({
  tileId,
  bundle,
  known,
  howMade,
  madeSignatures,
  mastery,
  onDismiss,
  onReport,
}: {
  tileId: string;
  bundle: ThemeBundle;
  /** Everything the player knows (this game + lifetime collection). */
  known: Set<string>;
  /** Ingredients the player actually used to make each output this run.
   *  When present for `tileId`, it wins over the bundle's canonical recipe
   *  so items with multiple valid recipes show the one the player made. */
  howMade: Record<string, string[]>;
  /** Sorted-ingredient signatures the player has ever made for this item
   *  (lifetime, across runs, scope-aware). Used to decorate each recipe row
   *  as "made before" vs. "haven't tried yet". */
  madeSignatures?: ReadonlySet<string>;
  /** Pre-computed mastery accounting for this item. Omitted in fast mode. */
  mastery?: MasteryInfo;
  onDismiss: () => void;
  /** Open the feedback sheet pre-seeded for this item. Omitted = no button. */
  onReport?: () => void;
}) {
  const item = bundle.items.get(tileId);
  if (!item) return null;
  // Only reveal recipes the player has earned the right to see — either
  // because they made it this run, or because the output is already known
  // (previous run, lifetime collection, or raw starting item). Otherwise
  // hide ingredients so long-pressing a tile can't be used to peek at how
  // to craft an undiscovered item.
  const playerRecipe = howMade[tileId];
  const isKnown = known.has(tileId);
  // Gather every bundle recipe that produces this tile whose ingredients
  // are all known to the player. "Known" here means in the player's
  // lifetime collection or a raw ingredient — otherwise the card would
  // leak a path the player hasn't earned.
  const allKnownRecipes = isKnown
    ? bundle.recipes.filter(
        (r) =>
          r.out === tileId &&
          r.all.every((partId) => known.has(partId) || bundle.base.includes(partId)),
      )
    : [];
  // Dedupe by sorted ingredient signature so the same recipe modelled as
  // multiple edges (e.g. alternative orderings) collapses to one row.
  const sigOf = (all: readonly string[]) => [...all].sort().join("+");
  const recipeRows: { all: string[]; used: boolean; made: boolean }[] = [];
  const seen = new Set<string>();
  const isMade = (sig: string): boolean => !!madeSignatures?.has(sig);
  for (const r of allKnownRecipes) {
    const sig = sigOf(r.all);
    if (seen.has(sig)) continue;
    seen.add(sig);
    recipeRows.push({ all: r.all.slice(), used: false, made: isMade(sig) });
  }
  // Mark the path the player actually used this run. Add it defensively
  // in case howMade recorded a recipe that isn't in the current bundle
  // (data drift between runs), so it still shows up as "used this run".
  if (playerRecipe) {
    const sig = sigOf(playerRecipe);
    const existing = recipeRows.find((row) => sigOf(row.all) === sig);
    if (existing) {
      existing.used = true;
      // The current run's make might not be reflected in `madeSignatures`
      // yet (POST is in flight / optimistic update hasn't settled). If the
      // player is holding the current recipe, mark it made too.
      existing.made = true;
    } else {
      recipeRows.push({ all: playerRecipe.slice(), used: true, made: true });
    }
  }
  // Lore fallback when no bundle / player recipe is visible — used for
  // items whose only "made from" story lives in the item view.
  const loreRecipe: { all: string[] } | null =
    isKnown && item.lore && recipeRows.length === 0
      ? { all: item.lore }
      : null;
  // For `canExplore` gating below, stay with the primary recipe (player
  // first, else first bundle row, else lore). Explore reveals should
  // only unlock when *at least one* complete path is visible, which the
  // existing logic captures.
  const madeFrom: { all: string[] } | null = playerRecipe
    ? { all: playerRecipe }
    : recipeRows[0]
      ? { all: recipeRows[0].all }
      : loreRecipe;
  // Goes into: recipes that use this tile as an ingredient.
  const goesInto = (bundle.byIngredient.get(tileId) ?? []).filter(
    (r) => r.out !== tileId,
  );
  const goesIntoOuts = Array.from(new Set(goesInto.map((r) => r.out)));
  const foundGoesIntoOuts = goesIntoOuts.filter((out) => known.has(out));
  const unfoundCount = goesIntoOuts.length - foundGoesIntoOuts.length;
  // Only link out to Explore once every neighbour the card could reveal is
  // already in the player's collection — the recipe's ingredients and every
  // downstream `goes into` output. Anything less lets Explore spoil the next
  // discovery.
  const ingredientsKnown =
    !!madeFrom && madeFrom.all.every((id) => known.has(id));
  const canExplore =
    isKnown && !!madeFrom && ingredientsKnown && unfoundCount === 0;
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
          <span className="pill cbinfo-kind">{KIND[item.kind]}</span>
          {mastery?.mastered ? (
            <span className="pill cbinfo-mastery mastered" aria-label="Mastered">
              <span aria-hidden="true">◆</span> Mastered
            </span>
          ) : mastery && mastery.available > 1 && mastery.made > 0 ? (
            <span
              className="pill cbinfo-mastery"
              aria-label={`${mastery.made} of ${mastery.available} recipes made`}
            >
              {mastery.made}/{mastery.available} recipes
            </span>
          ) : null}
        </div>
        <div className="nm">{cap(item.name)}</div>
        {recipeRows.length > 0 ? (
          recipeRows.map((row, rowIdx) => (
            <div
              key={sigOf(row.all)}
              className={`cbchip${row.used ? " used" : ""}${
                row.made ? " made" : " unmade"
              }`}
              aria-label={
                row.used
                  ? "Made from (used this run)"
                  : row.made
                  ? "Made from (made before)"
                  : "Made from (not yet made — tap to try)"
              }
            >
              {row.all.map((pid, k) => {
                const p = bundle.items.get(pid);
                if (!p) return null;
                return (
                  <React.Fragment key={`${rowIdx}-${pid}`}>
                    <span>
                      <Pictogram
                        name={p.name}
                        tier={p.tier}
                        kind={p.kind}
                        symbol={p.symbol}
                      />
                      {cap(p.name)}
                    </span>
                    {k < row.all.length - 1 && <i>+</i>}
                  </React.Fragment>
                );
              })}
              <i>=</i>
              <span>
                <Pictogram
                  name={item.name}
                  tier={item.tier}
                  kind={item.kind}
                  symbol={item.symbol}
                />
                {cap(item.name)}
              </span>
            </div>
          ))
        ) : loreRecipe ? (
          <div className="cbchip" aria-label="Made from">
            {loreRecipe.all.map((pid, k) => {
              const p = bundle.items.get(pid);
              if (!p) return null;
              return (
                <React.Fragment key={pid}>
                  <span>
                    <Pictogram
                      name={p.name}
                      tier={p.tier}
                      kind={p.kind}
                      symbol={p.symbol}
                    />
                    {cap(p.name)}
                  </span>
                  {k < loreRecipe.all.length - 1 && <i>+</i>}
                </React.Fragment>
              );
            })}
            <i>=</i>
            <span>
              <Pictogram
                name={item.name}
                tier={item.tier}
                kind={item.kind}
                symbol={item.symbol}
              />
              {cap(item.name)}
            </span>
          </div>
        ) : isKnown ? (
          <p className="fact">A raw thing.</p>
        ) : (
          <p className="fact">You haven&rsquo;t made this yet.</p>
        )}
        {item.fact && <p className="fact">{item.fact}</p>}
        {goesIntoOuts.length > 0 && (
          <div
            className="cbchip"
            aria-label="Goes into"
            style={{ marginTop: 4 }}
          >
            <b style={{ marginRight: 6 }}>Goes into:</b>
            {foundGoesIntoOuts.slice(0, 6).map((out) => {
              const o = bundle.items.get(out);
              if (!o) return null;
              return (
                <span key={out}>
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
        {canExplore && (
          <a
            className="cbh"
            href={`/explore/${item.slug}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Full story in Explore
          </a>
        )}
        <ButtonGroup>
          {onReport && (
            <button
              type="button"
              className="cbh"
              onClick={onReport}
              aria-label="Report this item"
            >
              Report
            </button>
          )}
          <button type="button" className="cbh" onClick={onDismiss}>
            Back to the game
          </button>
        </ButtonGroup>
    </ResponsiveSheet>
  );
}
