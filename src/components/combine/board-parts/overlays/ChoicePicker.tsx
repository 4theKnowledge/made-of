import React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { GameState } from "@/combine/engine";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";

export function ChoicePicker({
  state,
  bundle,
  known,
  onChoose,
  onCancel,
}: {
  state: GameState;
  bundle: ThemeBundle;
  known: Set<string>;
  onChoose: (outputIndex: number) => void;
  /** Only passed when `state.choosing.cancellable` — today, that's the
   *  promote picker. Shown as a Cancel button; the engine rolls back
   *  the promote via `lastSnapshot`. */
  onCancel?: () => void;
}) {
  if (!state.choosing) return null;
  const found = (id: string) => known.has(id);
  // Engine orders options: this-run finds first in natural order,
  // never-seen outputs shuffled deterministically by state.rng (so
  // daily puzzles stay identical across players). The shuffle stops
  // players muscle-memorising "?-slot 2 is always wood".
  const indexed = state.choosing.options.map((r, i) => ({ r, i }));
  const cancellable = state.choosing.cancellable && onCancel != null;
  const isIngredients = state.choosing.kind === "ingredients";
  // T-0270: when the player's drop landed on an ambiguous spot that
  // could satisfy more than one ingredient set, we show a distinct
  // picker that highlights the *ingredients* being consumed rather than
  // the output (which is picked in a follow-up step when the chosen set
  // has alternatives).
  if (isIngredients) {
    return (
      <div
        className="cbchoose cbchoose-ingredients"
        role="dialog"
        aria-label="Pick which recipe to combine"
      >
        <div className="k">These tiles could combine more than one way. Pick which recipe.</div>
        <div className="opts">
          {indexed.map(({ r, i }) => {
            const ingredients = r.all;
            return (
              <button
                key={i}
                type="button"
                className="cbopt cbopt-ingredients"
                onClick={() => onChoose(i)}
                aria-label={`Combine ${ingredients.map((id) => bundle.items.get(id)?.name ?? id).join(" + ")}`}
              >
                <span
                  className="cbopt-ingredients-row"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap", justifyContent: "center" }}
                >
                  {ingredients.map((id, j) => {
                    const it = bundle.items.get(id);
                    return (
                      <React.Fragment key={`${id}-${j}`}>
                        {j > 0 && (
                          <span aria-hidden="true" style={{ opacity: 0.6 }}>+</span>
                        )}
                        {it ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 2, ...fillVar(it) }}>
                            <Pictogram
                              name={it.name}
                              tier={it.tier}
                              kind={it.kind}
                              symbol={it.symbol}
                            />
                            <span>{cap(it.name)}</span>
                          </span>
                        ) : (
                          <span>{id}</span>
                        )}
                      </React.Fragment>
                    );
                  })}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="cbchoose" role="dialog" aria-label="Pick what to make">
      <div className="k">These make more than one thing. Pick one.</div>
      <div className="opts">
        {indexed.map(({ r, i }) => {
          const item = bundle.items.get(r.out);
          const isFound = found(r.out);
          const madeCount = state.madeCounts[r.out] ?? 0;
          const classes = ["cbopt"];
          if (!isFound) classes.push("unk");
          if (madeCount > 0) classes.push("made");
          return (
            <button
              key={r.out}
              type="button"
              className={classes.join(" ")}
              onClick={() => onChoose(i)}
              style={item && isFound ? fillVar(item) : undefined}
              aria-label={
                isFound && item
                  ? `${cap(item.name)}${madeCount > 0 ? `, made ${madeCount} time${madeCount === 1 ? "" : "s"} this run` : ""}`
                  : "Something new"
              }
            >
              {isFound && item ? (
                <>
                  <Pictogram
                    name={item.name}
                    tier={item.tier}
                    kind={item.kind}
                    symbol={item.symbol}
                  />
                  <span>{cap(item.name)}</span>
                </>
              ) : (
                <>
                  <b>?</b>
                  <span>Something new</span>
                </>
              )}
              {madeCount > 0 && (
                <span className="cbopt-made" aria-hidden="true">
                  ×{madeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {cancellable && (
        <button
          type="button"
          className="cbh"
          onClick={onCancel}
          aria-label="Cancel — don't make anything"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
