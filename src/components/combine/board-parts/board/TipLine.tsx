import React from "react";
import type { GameState } from "@/combine/engine";
import { cap } from "@/lib/taxonomy";
import type { Preview } from "@/components/combine/board-parts/types";

export function TipLine({
  state,
  hasSelection,
  preview,
  clearMode,
  moveMode,
  shoreMode,
}: {
  state: GameState;
  hasSelection: boolean;
  preview: Map<number, Preview>;
  clearMode: boolean;
  moveMode: { from: number | null } | null;
  shoreMode: boolean;
}) {
  let tip: string;
  if (state.over) tip = "Game over.";
  else if (state.choosing) tip = "These make more than one thing. Pick one.";
  else if (clearMode) tip = "Tap a tile to clear it.";
  else if (shoreMode) tip = "Tap a crumbling tile to steady it.";
  else if (moveMode) {
    if (moveMode.from == null) tip = "Tap the tile you want to move.";
    else {
      const name = state.board[moveMode.from];
      tip = `Now tap where the ${name ? cap(name).toLowerCase() : "tile"} should go. Moving isn't a turn.`;
    }
  } else if (hasSelection) {
    if (preview.size > 0) {
      tip =
        "Glowing squares make things you've found before. New combos don't glow: try things.";
    } else if (state.found.length) {
      tip =
        "No combo you know of. Try somewhere new, or place it where it can wait.";
    } else {
      tip =
        "Nothing glows until you've found it. Drop it on, or beside, things that might go with it.";
    }
  } else {
    tip =
      "Drag a tile onto the board, or tap it and then a square. Things that touch combine.";
  }
  return (
    <p className="cbtip" aria-live="polite">
      {tip}
    </p>
  );
}
