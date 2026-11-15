import React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { CombineRecipe, ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";

/**
 * Right-side column next to the board that surfaces recipes whose
 * ingredients are *entirely* present on board/tray/hold right now. Lets the
 * player see the local graph structure the dealer already knows — without
 * leaking un-discovered outputs.
 *
 * Tap a chip to toggle an ingredient-highlight state owned by the parent;
 * tap it again (or any other chip) to replace/clear. Chips render "?" for
 * recipes whose output the player hasn't yet discovered, so the column is
 * a decision aid, not a spoiler.
 */
export function ReachableColumn({
  bundle,
  recipes,
  found,
  activeRecipeId,
  onChipTap,
}: {
  bundle: ThemeBundle;
  recipes: CombineRecipe[];
  found: ReadonlySet<string>;
  activeRecipeId: string | null;
  onChipTap: (recipe: CombineRecipe) => void;
}) {
  if (recipes.length === 0) {
    return (
      <div
        className="cbreach-col cbreach-col-empty"
        aria-label="No recipes ready to combine with current tiles"
      >
        <div className="cbreach-col-inner">
          <span className="cbreach-empty-label" aria-hidden="true">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4l6 8M18 4l-6 8M12 12v8" />
            </svg>
            <em>No recipes</em>
          </span>
        </div>
      </div>
    );
  }
  return (
    <div
      className="cbreach-col"
      aria-label={`${recipes.length} recipes you can make with current tiles`}
    >
      <div className="cbreach-col-inner">
        {recipes.map((r) => {
          const it = bundle.items.get(r.out);
          const isFound = found.has(r.out);
          const isActive = activeRecipeId === r.id;
          const label = isFound && it
            ? `${cap(it.name)} — ${r.all.length} ingredients ready`
            : `Unknown recipe — ${r.all.length} ingredients ready`;
          return (
            <button
              key={r.id}
              type="button"
              className={`cbreach-chip${isActive ? " on" : ""}${isFound ? "" : " unknown"}`}
              style={isFound && it ? fillVar(it) : undefined}
              aria-label={label}
              aria-pressed={isActive}
              onClick={() => onChipTap(r)}
            >
              {isFound && it ? (
                <Pictogram
                  name={it.name}
                  tier={it.tier}
                  kind={it.kind}
                  symbol={it.symbol}
                />
              ) : (
                <span className="cbreach-q" aria-hidden="true">
                  ?
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
