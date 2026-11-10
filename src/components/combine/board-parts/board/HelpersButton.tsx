import React from "react";
import { WIPE_UNLOCK_CHAPTER, type GameState } from "@/combine/engine";
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

export function HelpersButton({
  state,
  helpersOpen,
  clearMode,
  moveMode,
  shoreMode,
  pluckMode,
  onToggleHelpers,
  onHelper,
}: {
  state: GameState;
  helpersOpen: boolean;
  clearMode: boolean;
  moveMode: boolean;
  shoreMode: boolean;
  pluckMode: boolean;
  onToggleHelpers: () => void;
  onHelper: (which: HelperKey) => void;
}) {
  const canUndo = state.undos > 0 && state.lastSnapshot != null;
  const wipeUnlocked = state.chapter >= WIPE_UNLOCK_CHAPTER;
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
  const modeActive = clearMode || moveMode || shoreMode || pluckMode;
  return (
    <div className="cbhelpwrap">
      <button
        className={`cbh cbhelpbtn${modeActive ? " on" : ""}${helpersOpen ? " open" : ""}`}
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
              ? "Wipe the board, costs one chapter"
              : `Wipe unlocks at chapter ${WIPE_UNLOCK_CHAPTER + 1}`
          }
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
          </svg>
          <span className="nm">
            <b className="t">Wipe</b>
            <em>
              {wipeUnlocked
                ? "Clear the board and hold. Costs one chapter."
                : `Unlocks at chapter ${WIPE_UNLOCK_CHAPTER + 1}.`}
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
  );
}
