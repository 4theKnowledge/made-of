import React, { useEffect, useState } from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { GameState } from "@/combine/engine";
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
  currentUserHandle,
  onClose,
  onPlayAgain,
  onShare,
}: {
  state: GameState;
  bundle: ThemeBundle;
  collection: Map<string, number>;
  best: number;
  currentUserHandle?: string | null;
  onClose: () => void;
  onPlayAgain: () => void;
  onShare: () => void;
}) {
  // Chapter the player ended at, computed from their cumulative finds so
  // the summary can say "Chapter 3" regardless of mid-game state drift.
  const endChapter = chapterIndex(state.found.length) + 1;
  const progressionLabel = `Chapter ${endChapter}`;
  const newBest = state.newBest;
  const isDailyTargetRun =
    state.mode === "daily" && state.target != null;
  const won =
    isDailyTargetRun && state.found.length >= (state.target ?? 0);
  const rank = useDailyRank({
    enabled: !!(won && state.daily && currentUserHandle),
    theme: state.theme,
    day: state.daily,
    handle: currentUserHandle ?? null,
  });
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
                : `You reached ${progressionLabel}.`}
        </span>
        <div className="cb3">
          {isDailyTargetRun ? (
            <>
              <div>
                <b>{state.moves}</b>
                <span>turns</span>
              </div>
              <div>
                <b>{state.found.length}{state.target != null ? ` / ${state.target}` : ""}</b>
                <span>discoveries</span>
              </div>
              <div>
                <b>{formatRank(rank, won, !!currentUserHandle)}</b>
                <span>{rankLabel(rank, won, !!currentUserHandle)}</span>
              </div>
            </>
          ) : (
            <>
              <div>
                <b>{state.shelf.length}</b>
                <span>finished things</span>
              </div>
              <div>
                <b>{progressionLabel}</b>
                <span>chapter reached</span>
              </div>
              <div>
                <b>{state.found.length}</b>
                <span>new discoveries</span>
              </div>
            </>
          )}
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

type RankState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ranked"; position: number; total: number }
  | { kind: "unranked"; total: number }
  | { kind: "error" };

/** Fetch today's daily leaderboard and resolve this player's position.
 *  The `/finish` submission is server-side so by the time the GameOver
 *  card renders, the row should already be committed; still, ranking is
 *  best-effort — failure quietly falls back to turn count only. */
function useDailyRank({
  enabled,
  theme,
  day,
  handle,
}: {
  enabled: boolean;
  theme: string;
  day: string | null;
  handle: string | null;
}): RankState {
  const [state, setState] = useState<RankState>({ kind: "idle" });
  useEffect(() => {
    if (!enabled || !day || !handle) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/combine/daily/leaderboard?day=${day}&theme=${theme}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`request_failed_${res.status}`);
        const j = (await res.json()) as {
          rows: Array<{ handle: string | null }>;
        };
        if (cancelled) return;
        const total = j.rows.length;
        const idx = j.rows.findIndex((r) => r.handle === handle);
        if (idx < 0) setState({ kind: "unranked", total });
        else setState({ kind: "ranked", position: idx + 1, total });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, theme, day, handle]);
  return state;
}

function formatRank(rank: RankState, won: boolean, signedIn: boolean): string {
  if (!won) return "—";
  if (!signedIn) return "Sign in";
  if (rank.kind === "loading" || rank.kind === "idle") return "…";
  if (rank.kind === "ranked") return `#${rank.position}`;
  return "—";
}

function rankLabel(rank: RankState, won: boolean, signedIn: boolean): string {
  if (!won) return "rank";
  if (!signedIn) return "to rank today";
  if (rank.kind === "ranked") return `of ${rank.total} today`;
  if (rank.kind === "loading" || rank.kind === "idle") return "ranking";
  return "rank unavailable";
}
