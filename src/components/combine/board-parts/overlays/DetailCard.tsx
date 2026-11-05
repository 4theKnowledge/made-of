import React, { useState } from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { ThemeBundle } from "@/combine/types";
import { cap, KIND } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";
import { ButtonGroup } from "@/components/common/ButtonGroup";
import type { MasteryInfo } from "@/components/combine/board-parts/types";
import { ReactionButtons } from "@/components/combine/board-parts/ReactionButtons";
import type { ReactionState, ReactionTarget } from "@/combine/useReactions";

/** What a picker option refers to. `recipe-row` carries the specific
 *  recipe's ingredient list (so the UI can show the chip) plus the
 *  recipe id to vote against. */
type PickerTarget =
  | { kind: "item" }
  | { kind: "recipe-row"; recipeId: string; all: string[] };

export function DetailCard({
  tileId,
  bundle,
  known,
  howMade,
  madeSignatures,
  mastery,
  itemReactions,
  onVoteReaction,
  reactionsAuthed,
  onDismiss,
  onReport,
  onReportRecipe,
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
  /** Reaction state keyed by item id (for the header buttons). */
  itemReactions?: ReadonlyMap<string, ReactionState>;
  /** Cast / flip / clear a vote for a target. Required for reactions to work. */
  onVoteReaction?: (
    target: ReactionTarget,
    id: string,
    value: -1 | 0 | 1,
  ) => void;
  /** Signed-in flag so the thumbs can degrade to sign-in prompts. */
  reactionsAuthed?: boolean;
  onDismiss: () => void;
  /** Open the feedback sheet pre-seeded for this item. Omitted = no button. */
  onReport?: () => void;
  /** Open the feedback sheet pre-seeded for a specific recipe (ingredient
   *  list + output). Called from a per-recipe-row report tap. */
  onReportRecipe?: (ingredients: string[]) => void;
}) {
  const item = bundle.items.get(tileId);
  // Routing-picker state. Thumbs-up is treated as a direct item-level vote
  // (positive feedback is almost always about the item, and the extra tap
  // would get in the way of a satisfying "nice" moment). Downvote and
  // Report route through the picker so the player can say "it's this
  // specific recipe, not the item in general" when they want to.
  const [pickerAction, setPickerAction] = useState<"down" | "report" | null>(
    null,
  );
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
  // `recipeId` carries the underlying recipes.id so reactions can vote on
  // the specific authored row. When `playerRecipe` comes via howMade but
  // isn't in the current bundle (content drift between runs), we leave
  // `recipeId` empty and the row hides its reaction group.
  const sigOf = (all: readonly string[]) => [...all].sort().join("+");
  const recipeRows: {
    all: string[];
    used: boolean;
    made: boolean;
    recipeId: string | null;
  }[] = [];
  const seen = new Set<string>();
  const isMade = (sig: string): boolean => !!madeSignatures?.has(sig);
  for (const r of allKnownRecipes) {
    const sig = sigOf(r.all);
    if (seen.has(sig)) continue;
    seen.add(sig);
    recipeRows.push({
      all: r.all.slice(),
      used: false,
      made: isMade(sig),
      recipeId: r.id || null,
    });
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
      recipeRows.push({
        all: playerRecipe.slice(),
        used: true,
        made: true,
        recipeId: null,
      });
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
            <span
              className="cbinfo-mastery-badge"
              aria-label="Mastered"
              title="Mastered"
            >
              <span aria-hidden="true">◆</span>
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
        {onVoteReaction && (
          <div className="cbinfo-rx">
            <ReactionButtons
              target="item"
              state={itemReactions?.get(tileId)}
              onVote={(value) => {
                // Direct path for thumbs-up: positive feedback is about
                // the item 99% of the time; picker would add friction
                // where none is needed. Clearing a positive vote
                // (value === 0 when the player untaps) also stays
                // direct — no need to pick a target to clear nothing.
                if (value === 1 || value === 0) {
                  onVoteReaction("item", tileId, value);
                  return;
                }
                // Thumbs-down opens the picker so the player can say
                // whether it's the item in general or a specific recipe.
                setPickerAction("down");
              }}
              onReport={() => setPickerAction("report")}
              authed={!!reactionsAuthed}
              size="xs"
              labels
            />
          </div>
        )}
        {pickerAction && onVoteReaction && (
          <ReactionTargetPicker
            action={pickerAction}
            item={item}
            bundle={bundle}
            rows={recipeRows}
            onCancel={() => setPickerAction(null)}
            onPick={(target) => {
              setPickerAction(null);
              if (pickerAction === "down") {
                if (target.kind === "item") {
                  onVoteReaction("item", tileId, -1);
                } else {
                  onVoteReaction("recipe", target.recipeId, -1);
                }
              } else {
                // Report path
                if (target.kind === "item") {
                  onReport?.();
                } else {
                  onReportRecipe?.(target.all);
                }
              }
            }}
          />
        )}
        {/* Description comes before recipes so the hierarchy reads as
         * identity → feedback → what-it-is → how-it's-made → where-it-goes.
         * The "A raw thing" / "haven't made this" fallbacks only render
         * when there's no fact AND no recipe to show, so we don't double
         * up with the real fact line below. */}
        {item.fact && <p className="fact">{item.fact}</p>}
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
        ) : isKnown && !item.fact ? (
          <p className="fact">A raw thing.</p>
        ) : !isKnown && !item.fact ? (
          <p className="fact">You haven&rsquo;t made this yet.</p>
        ) : null}
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
        {canExplore ? (
          <ButtonGroup align="stretch" style={{ marginTop: 12 }}>
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
          </ButtonGroup>
        ) : (
          <button
            type="button"
            className="cbh cbback"
            onClick={onDismiss}
            style={{ marginTop: 12 }}
          >
            Back to the game
          </button>
        )}
    </ResponsiveSheet>
  );
}

/** Routing picker: after a downvote or report tap, the player picks
 *  whether it targets the item or a specific recipe row. Pre-selects
 *  "This item" so a one-tap confirm is possible. Intentionally inline
 *  rather than a top-level sheet so it keeps its context (the player
 *  can still see which item they're rating). */
function ReactionTargetPicker({
  action,
  item,
  bundle,
  rows,
  onPick,
  onCancel,
}: {
  action: "down" | "report";
  item: { name: string; tier: string; kind: string; symbol: string | null };
  bundle: ThemeBundle;
  rows: ReadonlyArray<{ all: string[]; recipeId: string | null }>;
  onPick: (target: PickerTarget) => void;
  onCancel: () => void;
}) {
  // Only offer recipes that have an id we can vote on. Rows without an id
  // (player's run-recipe not in the current bundle) silently drop.
  const voteableRows = rows.filter((r) => r.recipeId);
  return (
    <div className="cbrx-picker" role="dialog" aria-label="What are you rating?">
      <div className="cbrx-picker-k">
        {action === "down" ? "What's off?" : "Report what?"}
      </div>
      <button
        type="button"
        className="cbrx-picker-opt item"
        onClick={() => onPick({ kind: "item" })}
      >
        <Pictogram
          name={item.name}
          tier={item.tier as never}
          kind={item.kind as never}
          symbol={item.symbol}
        />
        <span>
          <b>This item</b>
          <small>{cap(item.name)}</small>
        </span>
      </button>
      {voteableRows.map((row) => (
        <button
          key={row.recipeId!}
          type="button"
          className="cbrx-picker-opt"
          onClick={() =>
            onPick({
              kind: "recipe-row",
              recipeId: row.recipeId!,
              all: row.all,
            })
          }
        >
          <span className="cbrx-picker-recipe">
            {row.all.map((pid, i) => {
              const p = bundle.items.get(pid);
              if (!p) return null;
              return (
                <React.Fragment key={pid}>
                  {i > 0 && <i>+</i>}
                  <Pictogram
                    name={p.name}
                    tier={p.tier}
                    kind={p.kind}
                    symbol={p.symbol}
                  />
                </React.Fragment>
              );
            })}
          </span>
          <span>
            <b>This recipe</b>
            <small>{row.all.map((pid) => cap(bundle.items.get(pid)?.name ?? pid)).join(" + ")}</small>
          </span>
        </button>
      ))}
      <button type="button" className="cbrx-picker-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
