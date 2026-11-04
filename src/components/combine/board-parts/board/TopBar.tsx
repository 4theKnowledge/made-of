import React from "react";
import { WIPE_UNLOCK_AGE, type GameState } from "@/combine/engine";
import type { Fx } from "@/components/combine/board-parts/types";
import { formatDailyLabel } from "@/components/combine/board-parts/util";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";

export type HelperKey =
  | "hint"
  | "swap"
  | "clear"
  | "move"
  | "shore"
  | "pluck"
  | "wipe"
  | "undo";

export function TopBar({
  state,
  fx,
  best,
  helpersOpen,
  moreOpen,
  clearMode,
  moveMode,
  shoreMode,
  pluckMode,
  soundOn,
  onToggleHelpers,
  onToggleMore,
  onHelper,
  onTheme,
  onBook,
  onSound,
  onHelp,
  onIntro,
  onFeedback,
}: {
  state: GameState;
  fx: Fx;
  best: number;
  helpersOpen: boolean;
  moreOpen: boolean;
  clearMode: boolean;
  moveMode: boolean;
  shoreMode: boolean;
  pluckMode: boolean;
  soundOn: boolean;
  onToggleHelpers: () => void;
  onToggleMore: () => void;
  onHelper: (which: HelperKey) => void;
  onTheme: () => void;
  onBook: () => void;
  onSound: () => void;
  onHelp: () => void;
  onIntro: () => void;
  onFeedback: () => void;
}) {
  const canUndo = state.undos > 0 && state.lastSnapshot != null;
  const wipeUnlocked = state.age >= WIPE_UNLOCK_AGE;
  const holdFull = !state.hold.some((v) => v == null);
  const boardEmpty = !state.board.some((v) => v != null);
  const helpersLeft =
    state.swaps +
    state.clears +
    state.hints +
    state.mv +
    state.shore +
    state.pluck +
    (wipeUnlocked ? 1 : 0) +
    (canUndo ? 1 : 0);
  const themeName = state.daily
    ? "Daily"
    : state.mode === "fast"
      ? "Fast"
      : "Endless";
  const dailyLabel = state.daily ? formatDailyLabel(state.daily) : null;
  const fast = state.mode === "fast";
  const bestDisplay = Math.max(best, state.over ? state.score : 0);
  const modeActive = clearMode || moveMode || shoreMode || pluckMode;
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
        className={`cbh cbtheme${fast ? " cbtheme-fast" : ""}`}
        type="button"
        aria-label={`Theme: ${themeName}${dailyLabel ? `, ${dailyLabel}` : ""}. Change theme`}
        onClick={onTheme}
      >
        {fast ? (
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
      <div className="cbhelpwrap">
        <button
          className={`cbh${modeActive ? " on" : ""}${helpersOpen ? " open" : ""}`}
          id="cbHelp"
          type="button"
          aria-haspopup="menu"
          aria-expanded={helpersOpen}
          aria-label={modeActive ? "Cancel" : "Helpers"}
          onClick={onToggleHelpers}
          disabled={state.over || (!modeActive && helpersLeft === 0)}
        >
          {modeActive ? (
            <>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
              <span className="lbl">Cancel</span>
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 9h18v11H3zM8 9V5h8v4M3 13h18M11 12v3h2v-3" />
              </svg>
              <span className="lbl">Helpers</span>
              <b>{helpersLeft}</b>
            </>
          )}
        </button>
        <ResponsiveSheet
          open={helpersOpen && !state.over}
          onDismiss={onToggleHelpers}
          ariaLabel="Helpers"
          className="cbhelpmenu"
        >
          <span className="k cbhelptitle">Helpers</span>
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("hint")}
              disabled={state.hints === 0}
              aria-label={`Hint: show one new combo, ${state.hints} left`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
              </svg>
              <span className="nm">
                <b className="t">Hint</b>
                <em>
                  Point out a combo, new ones first. If nothing fits, it teaches a recipe.
                </em>
              </span>
              <b className="c">{state.hints}</b>
            </button>
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("move")}
              disabled={state.mv === 0}
              aria-label={`Move a tile on the board, ${state.mv} left`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
              </svg>
              <span className="nm">
                <b className="t">Move</b>
                <em>
                  Pick up a tile on the board and put it somewhere else. Not a turn.
                </em>
              </span>
              <b className="c">{state.mv}</b>
            </button>
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("swap")}
              disabled={state.swaps === 0}
              aria-label={`Swap the tray, ${state.swaps} left`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7h11l-3-3M17 17H6l3 3" />
              </svg>
              <span className="nm">
                <b className="t">Swap</b>
                <em>Trade your three tiles for three new ones</em>
              </span>
              <b className="c">{state.swaps}</b>
            </button>
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("clear")}
              disabled={state.clears === 0}
              aria-label={`Clear a tile, ${state.clears} left`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 6l4 4M12 8l6-6 4 4-6 6M13 11 4 20" />
              </svg>
              <span className="nm">
                <b className="t">Clear</b>
                <em>Remove one tile from the board</em>
              </span>
              <b className="c">{state.clears}</b>
            </button>
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("shore")}
              disabled={state.shore === 0}
              aria-label={`Shore up a crumbling tile, ${state.shore} left`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20h16M6 20V11l6-6 6 6v9M9 20v-6h6v6" />
              </svg>
              <span className="nm">
                <b className="t">Shore</b>
                <em>
                  Anchor a crumbling tile — it won&apos;t crumble again.
                </em>
              </span>
              <b className="c">{state.shore}</b>
            </button>
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("pluck")}
              disabled={state.pluck === 0 || holdFull || boardEmpty}
              aria-label={
                state.pluck === 0
                  ? "Pluck used"
                  : holdFull
                    ? "Pluck unavailable — hold is full"
                    : boardEmpty
                      ? "Pluck unavailable — board is empty"
                      : `Pluck a tile into hold, ${state.pluck} left`
              }
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3v10M9 10l3 3 3-3M5 15v5h14v-5" />
              </svg>
              <span className="nm">
                <b className="t">Pluck</b>
                <em>Pull a tile off the board into hold. Not a turn.</em>
              </span>
              <b className="c">{state.pluck}</b>
            </button>
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("wipe")}
              disabled={!wipeUnlocked}
              aria-label={
                wipeUnlocked
                  ? "Wipe the board, costs one age"
                  : `Wipe unlocks at age ${WIPE_UNLOCK_AGE + 1}`
              }
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
              </svg>
              <span className="nm">
                <b className="t">Wipe</b>
                <em>
                  {wipeUnlocked
                    ? "Clear the board and hold. Costs one age."
                    : `Unlocks at age ${WIPE_UNLOCK_AGE + 1}.`}
                </em>
              </span>
            </button>
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("undo")}
              disabled={!canUndo}
              aria-label={
                canUndo
                  ? `Undo last move, ${state.undos} left`
                  : state.undos > 0
                    ? "Undo unavailable — no move to undo or last turn unlocked something"
                    : "Undo used"
              }
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 14l-5-5 5-5M4 9h10a6 6 0 0 1 0 12h-4" />
              </svg>
              <span className="nm">
                <b className="t">Undo</b>
                <em>
                  Take back your last tile. Can&apos;t undo past a new discovery.
                </em>
              </span>
              <b className="c">{state.undos}</b>
            </button>
        </ResponsiveSheet>
      </div>
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
                aria-label="Show intro"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span className="nm">
                  <b className="t">Show intro</b>
                  <em>Replay the welcome demo</em>
                </span>
              </button>
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
        </ResponsiveSheet>
      </div>
    </div>
  );
}
