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
