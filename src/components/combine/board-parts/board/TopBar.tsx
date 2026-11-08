import React from "react";
import Link from "next/link";
import type { GameState } from "@/combine/engine";
import type { Fx } from "@/components/combine/board-parts/types";
import { formatDailyLabel } from "@/components/combine/board-parts/util";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";

export type { HelperKey } from "@/components/combine/board-parts/board/HelpersButton";

export function TopBar({
  state,
  fx,
  best,
  moreOpen,
  soundOn,
  signedIn,
  isAdmin,
  onToggleMore,
  onTheme,
  onBook,
  onSound,
  onDebug,
  onHelp,
  onIntro,
  onFeedback,
  onEndRun,
  canEndRun,
}: {
  state: GameState;
  fx: Fx;
  best: number;
  moreOpen: boolean;
  soundOn: boolean;
  signedIn: boolean;
  isAdmin: boolean;
  onToggleMore: () => void;
  onTheme: () => void;
  onBook: () => void;
  onSound: () => void;
  /** Open the playtest-experiments sheet. Caller should only pass this when
   *  `NEXT_PUBLIC_COMBINE_PLAYTEST=1`; the menu row renders iff passed. */
  onDebug?: () => void;
  onHelp: () => void;
  onIntro: () => void;
  onFeedback: () => void;
  /** Open the end-run confirm. Caller is expected to pass this only for
   *  modes where ending early is allowed (endless, fast). */
  onEndRun?: () => void;
  /** True when the player has banked something worth ending on. Disables
   *  the menu row when false so a zero-score misclick can't cut a run. */
  canEndRun?: boolean;
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
      <div className="cbmorewrap">
        <button
          type="button"
          id="cbMore"
          className={`cbsnd${moreOpen ? " on" : ""}`}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="More"
          title="More"
          onClick={onToggleMore}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <ResponsiveSheet
          open={moreOpen}
          onDismiss={onToggleMore}
          ariaLabel="More"
          className="cbmoremenu cbhelpmenu"
        >
          <span className="k cbhelptitle">More</span>
              <Link
                href="/"
                className="cbhm"
                aria-label="Back to home"
                onClick={onToggleMore}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" />
                </svg>
                <span className="nm">
                  <b className="t">Home</b>
                  <em>Back to the Made Of home</em>
                </span>
              </Link>
              <button
                type="button"
                className="cbhm"
                onClick={onBook}
                aria-label="Open collection"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5c3-1 6-1 8 1v14c-2-2-5-2-8-1zM20 5c-3-1-6-1-8 1v14c2-2 5-2 8-1z" />
                </svg>
                <span className="nm">
                  <b className="t">Collection</b>
                  <em>Everything you&apos;ve ever found</em>
                </span>
              </button>
              <button
                type="button"
                className="cbhm"
                onClick={onSound}
                aria-label="Music and sound settings"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 9h4l5-4v14l-5-4H4z" />
                  {soundOn ? (
                    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
                  ) : (
                    <path d="M17 9l5 6M22 9l-5 6" />
                  )}
                </svg>
                <span className="nm">
                  <b className="t">Music &amp; sound</b>
                  <em>{soundOn ? "On" : "Off"}</em>
                </span>
              </button>
              {onDebug && isAdmin && (
                <button
                  type="button"
                  className="cbhm"
                  onClick={onDebug}
                  aria-label="Admin debug panel"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 3h4v6l5 11a3 3 0 0 1-3 4H8a3 3 0 0 1-3-4l5-11V3H6z" />
                    <path d="M9 3h6" />
                  </svg>
                  <span className="nm">
                    <b className="t">Debug</b>
                    <em>Admin-only</em>
                  </span>
                </button>
              )}
              <button
                type="button"
                className="cbhm"
                onClick={onHelp}
                aria-label="How to play"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M9.3 9.2a2.7 2.7 0 1 1 4.2 2.4c-1 .6-1.5 1.2-1.5 2.4" />
                  <circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none" />
                </svg>
                <span className="nm">
                  <b className="t">How to play</b>
                  <em>Rules and tips</em>
                </span>
              </button>
              <button
                type="button"
                className="cbhm"
                onClick={onIntro}
                aria-label="Replay tutorial"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span className="nm">
                  <b className="t">Replay tutorial</b>
                  <em>Walk through the basics again</em>
                </span>
              </button>
              {onEndRun && (
                <button
                  type="button"
                  className="cbhm"
                  onClick={onEndRun}
                  disabled={!canEndRun}
                  aria-label="End run and bank score"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 4h4v16H5zM13 4l7 8-7 8z" />
                  </svg>
                  <span className="nm">
                    <b className="t">End run</b>
                    <em>
                      {canEndRun
                        ? "Bank your score and start fresh"
                        : "Score something first"}
                    </em>
                  </span>
                </button>
              )}
              <button
                type="button"
                className="cbhm"
                onClick={onFeedback}
                aria-label="Send feedback"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5h16v11H8l-4 4z" />
                </svg>
                <span className="nm">
                  <b className="t">Send feedback</b>
                  <em>Suggest items, recipes, or flag issues</em>
                </span>
              </button>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="cbhm"
                  aria-label="Open admin"
                  onClick={onToggleMore}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3l9 4-9 4-9-4 9-4zM3 11l9 4 9-4M3 15l9 4 9-4" />
                  </svg>
                  <span className="nm">
                    <b className="t">Admin</b>
                    <em>Content, themes, debug</em>
                  </span>
                </Link>
              )}
              <Link
                href={signedIn ? "/account" : "/sign-in"}
                className="cbhm"
                aria-label={signedIn ? "Account" : "Sign in"}
                onClick={onToggleMore}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
                </svg>
                <span className="nm">
                  <b className="t">{signedIn ? "Account" : "Sign in"}</b>
                  <em>
                    {signedIn
                      ? "Settings, stats, sign out"
                      : "Sync your scores + collection"}
                  </em>
                </span>
              </Link>
        </ResponsiveSheet>
      </div>
    </div>
  );
}
