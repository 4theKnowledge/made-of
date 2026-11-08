import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { GameState } from "@/combine/engine";
import { chapterIndex } from "@/combine/progression";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";
import { ButtonGroup } from "@/components/common/ButtonGroup";
import { ManifestGrid } from "@/components/combine/board-parts/ManifestGrid";

/** T-0217 Slice 1b: the newest completion row for the active theme, or
 *  null if the player has never completed it (or isn't signed in). */
export interface ThemeCompletion {
  themeCode: string;
  completedVersion: number;
  completedAt: string;
  itemCount: number;
}

export function GameOverCard({
  state,
  bundle,
  collection,
  best,
  currentUserHandle,
  authed = false,
  themeCompletion = null,
  durationMs = null,
  finishing = false,
  isAdmin = false,
  onClose,
  onPlayAgain,
  onShare,
  onReplayDaily,
}: {
  state: GameState;
  bundle: ThemeBundle;
  collection: Map<string, number>;
  best: number;
  currentUserHandle?: string | null;
  /** Signed-in flag — gates the completion ceremony. Signed-out players
   *  don't persist discoveries so completion is meaningless for them. */
  authed?: boolean;
  /** Newest completion row for `state.theme`, if any. Null = never
   *  completed; `completedVersion < bundle.theme.collectionVersion` = a
   *  re-completion opportunity against newer admin-added items. */
  themeCompletion?: ThemeCompletion | null;
  /** Elapsed time for the run in ms (client-measured, server-trusted).
   *  Null for endless/fast runs and legacy daily runs that pre-date the
   *  timer. */
  durationMs?: number | null;
  /** True while `/finish` is still in flight. Gates the daily-rank
   *  fetch so we don't race the `progress` insert — before T-0234 the
   *  rank lookup fired on card mount and almost always lost the race,
   *  which is why ranks showed "—" / unranked. */
  finishing?: boolean;
  /** Admin viewer — unlocks the "Replay daily" button for playtesting
   *  without affecting non-admin flow. */
  isAdmin?: boolean;
  onClose: () => void;
  onPlayAgain: () => void;
  onShare: () => void;
  /** Admin-only — restarts today's daily server-side with `restart:true`.
   *  When omitted (non-admin / endless / fast), the Replay-daily button
   *  is suppressed. */
  onReplayDaily?: () => void;
}) {
  // Chapter the player ended at, computed from their cumulative finds so
  // the summary can say "Chapter 3" regardless of mid-game state drift.
  const endChapter = chapterIndex(state.found.length) + 1;
  const progressionLabel = `Chapter ${endChapter}`;
  const newBest = state.newBest;
  // Manifest-win for daily runs (T-0244). A run "won" when the engine
  // ended the run with every manifest item found; a board-clog ends
  // the run as a loss (partial completion still ranks via the
  // leaderboard's manifestFound sort).
  const isDailyTargetRun = state.mode === "daily";
  const manifest = state.manifest ?? [];
  const manifestFoundCount = state.manifestFound.length;
  const manifestSize = manifest.length;
  const won =
    isDailyTargetRun && manifestSize > 0 && manifestFoundCount >= manifestSize;
  const rank = useDailyRank({
    // Gate on `!finishing` so we don't fetch before `/finish` commits
    // the `progress` row. Pre-fix, the fetch fired on mount and almost
    // always lost the race — leaderboard returned the pre-insert list
    // and the player appeared "unranked" even on completions.
    enabled: !!(won && state.daily && currentUserHandle && !finishing),
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

  // T-0217 Slice 1b: completion ceremony. Collectables mirror
  // CollectionBook's derivation (outputs ∪ base). `got` merges the
  // lifetime collection with this run's finds so the ceremony can fire
  // on the very run that pushed the player over.
  const collectables = useMemo(() => {
    const s = new Set<string>(bundle.outputs);
    for (const id of bundle.base) s.add(id);
    return s;
  }, [bundle.outputs, bundle.base]);
  const got = useMemo(() => {
    const s = new Set<string>();
    for (const id of collection.keys()) if (collectables.has(id)) s.add(id);
    for (const id of state.found) if (collectables.has(id)) s.add(id);
    return s;
  }, [collection, state.found, collectables]);
  const isComplete = got.size >= collectables.size && collectables.size > 0;
  const currentVersion = bundle.theme.collectionVersion;
  const isCurrentVersion =
    themeCompletion?.completedVersion === currentVersion;
  const showCeremony =
    authed &&
    state.mode === "endless" &&
    isComplete &&
    !isCurrentVersion;

  // Fire-once POST per mount when the ceremony is showing. 409/403/network
  // errors are swallowed — the UI is truthful from the client's perspective
  // and the server reconciles on next GET.
  const posted = useRef(false);
  useEffect(() => {
    if (!showCeremony || posted.current) return;
    posted.current = true;
    void fetch("/api/me/combine/theme-completion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        themeCode: state.theme,
        version: currentVersion,
      }),
    }).catch(() => {
      // best-effort; nothing to do
    });
  }, [showCeremony, state.theme, currentVersion]);

  // Badge pictogram: ThemeMeta doesn't yet carry a pictogram (slice 1a
  // threaded label/description/collectionVersion only). Use a static
  // diamond glyph for now — follow-up to plumb `combineThemes.pictogram`
  // through ThemeMeta.
  const ceremonyItemCount = collectables.size;

  return (
    <ResponsiveSheet
      open
      onDismiss={onClose}
      ariaLabel="Run over"
      className="cbresult"
    >
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
        {showCeremony && (
          <section className="cbcomplete" aria-label="Collection complete">
            <div className="cbcomplete-badge" aria-hidden="true">
              {bundle.theme.pictogram ? (
                <Pictogram
                  name={`theme:${bundle.theme.k}`}
                  tier="M"
                  kind="object"
                  pictogram={bundle.theme.pictogram}
                />
              ) : (
                <svg viewBox="0 0 32 32">
                  <path
                    d="M16 3 L29 16 L16 29 L3 16 Z"
                    fill="currentColor"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            <b className="cbcomplete-title">COLLECTION COMPLETE</b>
            <span className="cbcomplete-theme">{bundle.theme.name}</span>
            <span className="cbcomplete-count">
              {ceremonyItemCount} of {ceremonyItemCount}
            </span>
          </section>
        )}
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
            ? manifestSize > 0
              ? won
                ? `Found every item in ${state.moves} turn${state.moves === 1 ? "" : "s"}.`
                : `${manifestFoundCount} / ${manifestSize} manifest items in ${state.moves} turn${state.moves === 1 ? "" : "s"}. The board ran out.`
              : `${state.found.length} discover${state.found.length === 1 ? "y" : "ies"} in ${state.moves} turns. The board ran out.`
            : newBest
              ? "A new best!"
              : best > state.score
                ? `Your best is ${best.toLocaleString("en")}. ${(best - state.score).toLocaleString("en")} to go.`
                : `You reached ${progressionLabel}.`}
        </span>
        <div className={isDailyTargetRun ? "cb4" : "cb3"}>
          {isDailyTargetRun ? (
            <>
              <div>
                <b>{state.moves}</b>
                <span>turns</span>
              </div>
              <div>
                <b>
                  {manifestSize > 0
                    ? `${manifestFoundCount} / ${manifestSize}`
                    : state.found.length}
                </b>
                <span>{manifestSize > 0 ? "manifest" : "discoveries"}</span>
              </div>
              <div>
                <b>{durationMs != null ? formatDuration(durationMs) : "—"}</b>
                <span>time</span>
              </div>
              <div>
                <b>
                  {formatRank(rank, won, !!currentUserHandle, finishing)}
                </b>
                <span>
                  {rankLabel(rank, won, !!currentUserHandle, finishing)}
                </span>
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
        {manifestSize > 0 ? (
          <>
            <p className="sub" style={{ marginTop: 4 }}>
              Manifest
            </p>
            <ManifestGrid
              manifest={manifest}
              manifestFound={state.manifestFound}
              bundle={bundle}
              mode="end"
            />
          </>
        ) : (
          state.found.length > 0 && (
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
          )
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
          {isAdmin && state.daily && onReplayDaily && (
            <button
              type="button"
              className="cbh"
              onClick={onReplayDaily}
              title="Admin: replay today's daily"
            >
              Replay daily
            </button>
          )}
        </ButtonGroup>
    </ResponsiveSheet>
  );
}

/** Render a run duration as `mm:ss` (or `h:mm:ss` beyond one hour).
 *  Rounds down to the nearest second — the daily clock is tracked at
 *  millisecond precision so leaderboard tie-breaks stay decisive, but
 *  the display rounds so "1:23.456" doesn't flicker. */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
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

function formatRank(
  rank: RankState,
  won: boolean,
  signedIn: boolean,
  finishing: boolean,
): string {
  if (!won) return "—";
  if (!signedIn) return "Sign in";
  // While /finish is in flight the fetch is suppressed and `rank.kind`
  // stays `idle` — show the same spinner glyph as `loading` so the
  // player sees "working" rather than a flash of "—".
  if (finishing || rank.kind === "loading" || rank.kind === "idle") return "…";
  if (rank.kind === "ranked") return `#${rank.position}`;
  return "—";
}

function rankLabel(
  rank: RankState,
  won: boolean,
  signedIn: boolean,
  finishing: boolean,
): string {
  if (!won) return "rank";
  if (!signedIn) return "set handle to rank";
  if (finishing) return "saving run";
  if (rank.kind === "ranked") return `of ${rank.total} today`;
  if (rank.kind === "loading" || rank.kind === "idle") return "ranking";
  return "rank unavailable";
}
