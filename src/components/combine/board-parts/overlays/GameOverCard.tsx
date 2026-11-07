import React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { GameState } from "@/combine/engine";
import { getGpOverrides } from "@/combine/gp-overrides";
import { chapterIndex } from "@/combine/progression";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";
import { ButtonGroup } from "@/components/common/ButtonGroup";

export function GameOverCard({
  state,
  bundle,
  collection,
  best,
  onClose,
  onPlayAgain,
  onShare,
}: {
  state: GameState;
  bundle: ThemeBundle;
  collection: Map<string, number>;
  best: number;
  onClose: () => void;
  onPlayAgain: () => void;
  onShare: () => void;
}) {
  const ages = bundle.theme.ages;
  const ageName = ages[state.chapter];
  const softMode = getGpOverrides().mode === "soft";
  // In soft mode the progression unit is a chapter, not a banded era.
  // Compute the chapter the player ended at from their cumulative finds
  // so the summary says "Chapter 3" instead of a thematic Age label.
  const endChapter = softMode ? chapterIndex(state.found.length) + 1 : 0;
  const progressionLabel = softMode ? `Chapter ${endChapter}` : ageName;
  const newBest = state.newBest;
  const isDailyTargetRun =
    state.mode === "daily" && state.target != null;
  const won =
    isDailyTargetRun && state.found.length >= (state.target ?? 0);
  // Mini-shelf: group by output.
  const shelfCounts = new Map<string, number>();
  for (const id of state.shelf) {
    shelfCounts.set(id, (shelfCounts.get(id) ?? 0) + 1);
  }
  // "N of Y discovered so far" is a lifetime figure, so merge this run's
  // new finds with the lifetime collection (mirrors CollectionBook). Fast
  // mode's finds never persist, so skip the merge there — the summary
  // should reflect the untouched lifetime collection.
  const themeDiscoveredSet = new Set<string>();
  for (const id of collection.keys()) {
    if (bundle.outputs.has(id)) themeDiscoveredSet.add(id);
  }
  if (state.mode !== "fast") {
    for (const id of state.found) {
      if (bundle.outputs.has(id)) themeDiscoveredSet.add(id);
    }
  }
  const themeDiscovered = themeDiscoveredSet.size;
  const totalOutputs = bundle.outputs.size;
  return (
    <ResponsiveSheet open onDismiss={onClose} ariaLabel="Run over">
      <button
        type="button"
        className="cbx"
        aria-label="View board"
        onClick={onClose}
      >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <span className="k">
          {isDailyTargetRun
            ? won
              ? `Daily complete · ${state.daily}`
              : `Daily stopped · ${state.daily}`
            : state.daily
              ? `Daily game · ${state.daily}`
              : "Board full"}
        </span>
        <b className="big">{state.score.toLocaleString("en")}</b>
        <span className="sub">
          {isDailyTargetRun
            ? won
              ? `All ${state.target} discovered in ${state.moves} turns.`
              : `${state.found.length} / ${state.target} discovered in ${state.moves} turns. The board ran out.`
            : newBest
              ? "A new best!"
              : best > state.score
                ? `Your best is ${best.toLocaleString("en")}. ${(best - state.score).toLocaleString("en")} to go.`
                : softMode
                  ? `You reached ${progressionLabel}.`
                  : `You reached Age ${ageName}.`}
        </span>
        <div className="cb3">
          <div>
            <b>{state.shelf.length}</b>
            <span>finished things</span>
          </div>
          <div>
            <b>{progressionLabel}</b>
            <span>{softMode ? "chapter reached" : "age reached"}</span>
          </div>
          <div>
            <b>{state.found.length}</b>
            <span>new discoveries</span>
          </div>
        </div>
        {state.shelf.length > 0 && (
          <div className="cbshelf sum">
            {[...shelfCounts.entries()].map(([id, n]) => {
              const it = bundle.items.get(id);
              if (!it) return null;
              return (
                <span
                  key={id}
                  className="cbslot"
                  style={fillVar(it)}
                  title={cap(it.name)}
                >
                  <Pictogram
                    name={it.name}
                    tier={it.tier}
                    kind={it.kind}
                    symbol={it.symbol}
                  />
                  {n > 1 && <b>{n}</b>}
                </span>
              );
            })}
          </div>
        )}
        {state.found.length > 0 && (
          <>
            <p className="sub" style={{ marginTop: 4 }}>
              New discoveries
            </p>
            <div className="cbchip cbfound">
              {state.found.slice(0, 10).map((id) => {
                const it = bundle.items.get(id);
                if (!it) return null;
                return (
                  <span key={id} style={fillVar(it)}>
                    <Pictogram
                      name={it.name}
                      tier={it.tier}
                      kind={it.kind}
                      symbol={it.symbol}
                    />
                    <em>{cap(it.name)}</em>
                  </span>
                );
              })}
              {state.found.length > 10 && (
                <span className="more">
                  +{state.found.length - 10} more in your collection
                </span>
              )}
            </div>
          </>
        )}
        <p className="sub">
          {themeDiscovered} of {totalOutputs} things discovered in{" "}
          {bundle.theme.name} so far.
        </p>
        <ButtonGroup>
          <button type="button" className="cbh" onClick={onShare}>
            Share
          </button>
          <button type="button" className="cbh" onClick={onPlayAgain}>
            {state.daily ? "Play endless" : "Play again"}
          </button>
        </ButtonGroup>
    </ResponsiveSheet>
  );
}
