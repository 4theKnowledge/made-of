import React from "react";
import type { GameState } from "@/combine/engine";
import { chapterIndex, chapterThreshold } from "@/combine/progression";
import type { ThemeBundle } from "@/combine/types";

export function AgeBar({
  state,
  bundle: _bundle,
  onAges,
}: {
  state: GameState;
  bundle: ThemeBundle;
  onAges: () => void;
}) {
  // Progression is log-scaled chapters measured against cumulative unique
  // discoveries. "Ch N — X/Y → N+1".
  const foundCount = state.found.length;
  const chapter = chapterIndex(foundCount);
  const curThreshold = chapterThreshold(chapter);
  const nextThreshold = chapterThreshold(chapter + 1);
  const inChapter = foundCount - curThreshold;
  const chapterSpan = nextThreshold - curThreshold;
  const finite = Number.isFinite(nextThreshold);
  const pct = !finite
    ? 100
    : Math.min(100, Math.round((inChapter / Math.max(1, chapterSpan)) * 100));
  const ariaLabel = finite
    ? `Chapter ${chapter + 1}. ${nextThreshold - foundCount} more unique finds to reach Chapter ${chapter + 2}. Tap for details.`
    : `Chapter ${chapter + 1} — open-ended. Tap for details.`;
  return (
    <div className="cbage">
      <button
        type="button"
        className="cbageinfo"
        aria-label={ariaLabel}
        onClick={onAges}
      >
        <span className="bar">
          <i style={{ width: `${pct}%` }} />
          <span className="an">Ch {chapter + 1}</span>
          <span className="nx">
            {finite
              ? `${inChapter}/${chapterSpan} → Ch ${chapter + 2}`
              : "Open-ended"}
          </span>
        </span>
      </button>
    </div>
  );
}
