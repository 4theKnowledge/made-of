import React from "react";
import type { GameState } from "@/combine/engine";
import type { Fx } from "@/components/combine/board-parts/types";
import { formatDailyLabel } from "@/components/combine/board-parts/util";
import { MoreButton } from "@/components/combine/board-parts/board/MoreButton";

export type { HelperKey } from "@/components/combine/board-parts/board/HelpersButton";

export function TopBar({
  state,
  fx,
  best,
  onTheme,
  moreOpen,
  soundOn,
  signedIn,
  isAdmin,
  canEndRun,
  onToggleMore,
  onBook,
  onSound,
  onDebug,
  onHelp,
  onIntro,
  onFeedback,
  onEndRun,
}: {
  state: GameState;
  fx: Fx;
  best: number;
  onTheme: () => void;
  moreOpen: boolean;
  soundOn: boolean;
  signedIn: boolean;
  isAdmin: boolean;
  canEndRun?: boolean;
  onToggleMore: () => void;
  onBook: () => void;
  onSound: () => void;
  onDebug?: () => void;
  onHelp: () => void;
  onIntro: () => void;
  onFeedback: () => void;
  onEndRun?: () => void;
}) {
  const themeName = state.daily
    ? "Daily"
    : state.mode === "fast"
      ? "Fast"
      : state.mode === "tutorial"
        ? "Tutorial"
        : "Endless";
  const dailyLabel = state.daily ? formatDailyLabel(state.daily) : null;
  const fast = state.mode === "fast";
  const tutorial = state.mode === "tutorial";
  const bestDisplay = Math.max(best, state.over ? state.score : 0);
  return (
    <div className={`cbtop${state.daily ? " cbtop-daily" : ""}`}>
      <div className="cbscore">
        <b>{state.score.toLocaleString("en")}</b>
        <span>best {bestDisplay.toLocaleString("en")}</span>
      </div>
      {fx.chain && fx.chain > 1 ? (
        <span className="cbchain" aria-live="polite">
          ×{fx.chain} chain
        </span>
      ) : null}
      {fx.close ? (
        <span className="cbchain cbclose" aria-live="polite">
          Close call! +{fx.close}
        </span>
      ) : null}
      <button
        className={`cbh cbtheme${fast ? " cbtheme-fast" : ""}${tutorial ? " cbtheme-tutorial" : ""}`}
        type="button"
        aria-label={`Theme: ${themeName}${dailyLabel ? `, ${dailyLabel}` : ""}. Change theme`}
        onClick={onTheme}
      >
        {tutorial ? (
          <svg
            className="cbtheme-mode cbtheme-book"
            viewBox="0 0 32 32"
            aria-hidden="true"
          >
            <path d="M4 7v18l12-3 12 3V7l-12 3z" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
            <path d="M16 10v18" fill="none" stroke="currentColor" strokeWidth={2} />
          </svg>
        ) : fast ? (
          <svg
            className="cbtheme-mode cbtheme-bolt"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path
              d="M9 1 L3 9 h3 l-2 6 L13 7 h-3 l2 -6 z"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth={0.5}
              strokeLinejoin="round"
            />
          </svg>
        ) : state.daily ? (
          <svg
            className="cbtheme-mode cbtheme-cal"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />
          </svg>
        ) : (
          <svg
            className="cbtheme-mode cbtheme-inf"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M8 8c-2.76 0-5 1.79-5 4s2.24 4 5 4c1.75 0 3.19-.72 4-1.84C12.81 15.28 14.25 16 16 16c2.76 0 5-1.79 5-4s-2.24-4-5-4c-1.75 0-3.19.72-4 1.84C11.19 8.72 9.75 8 8 8z" />
          </svg>
        )}
        <span>
          {themeName}
          {dailyLabel && <em className="cbtheme-day">{dailyLabel}</em>}
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <MoreButton
        moreOpen={moreOpen}
        soundOn={soundOn}
        signedIn={signedIn}
        isAdmin={isAdmin}
        canEndRun={canEndRun}
        onToggleMore={onToggleMore}
        onBook={onBook}
        onSound={onSound}
        onDebug={onDebug}
        onHelp={onHelp}
        onIntro={onIntro}
        onFeedback={onFeedback}
        onEndRun={onEndRun}
      />
    </div>
  );
}
