import React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { GameState } from "@/combine/engine";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import type { Fx } from "@/components/combine/board-parts/types";
import { Shelf } from "@/components/combine/board-parts/board/Shelf";
import { fillVar } from "@/components/combine/board-parts/util";

/**
 * Row below the ChapterBar that holds the run's "History" strip. In daily
 * mode with a manifest it splits into two scrollable columns — left for the
 * manifest to find, right for the shelf of what's already been made — so the
 * daily layout matches the endless layout's vertical height (T-0334). In
 * endless mode the shelf takes the row full-width (no visual change).
 */
export function HistoryRow({
  state,
  bundle,
  fx,
  newUnlocks,
  onInfo,
  onOpenManifest,
}: {
  state: GameState;
  bundle: ThemeBundle;
  fx: Fx;
  newUnlocks?: ReadonlySet<string>;
  onInfo: (id: string) => void;
  onOpenManifest: () => void;
}) {
  const manifest = state.manifest ?? [];
  const showManifest =
    state.mode === "daily" && manifest.length > 0;
  if (!showManifest) {
    return (
      <Shelf
        state={state}
        bundle={bundle}
        fx={fx}
        newUnlocks={newUnlocks}
        onInfo={onInfo}
      />
    );
  }
  const foundSet = new Set(state.manifestFound);
  const foundN = foundSet.size;
  const total = manifest.length;
  const label = `Daily finds: ${foundN} of ${total}. Tap for details.`;
  return (
    <div className="cbhistrow">
      <button
        type="button"
        className="cbhistrow-finds"
        aria-label={label}
        onClick={onOpenManifest}
      >
        <span className="cbhistrow-finds-slots">
          {manifest.map((id) => {
            const it = bundle.items.get(id);
            const found = foundSet.has(id);
            const title = it
              ? `${cap(it.name)} · ${found ? "found" : "to find"}`
              : id;
            return (
              <span
                key={id}
                className={`cbfindsstrip-chip${found ? " on" : ""}`}
                style={it ? fillVar(it) : undefined}
                title={title}
              >
                {it && (
                  <Pictogram
                    name={it.name}
                    tier={it.tier}
                    kind={it.kind}
                    symbol={it.symbol}
                  />
                )}
                {found && (
                  <span className="cbfindsstrip-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </span>
            );
          })}
        </span>
        <span className="cbhistrow-finds-tally" aria-hidden="true">
          <em>
            Find {foundN}/{total}
          </em>
        </span>
      </button>
      <Shelf
        state={state}
        bundle={bundle}
        fx={fx}
        newUnlocks={newUnlocks}
        onInfo={onInfo}
      />
    </div>
  );
}
