import React from "react";
import type { GameState } from "@/combine/engine";
import { chapterIndex, chapterThreshold } from "@/combine/progression";
import type { ThemeBundle } from "@/combine/types";

export function ChapterBar({
  state,
  bundle: _bundle,
  onAges,
}: {
  state: GameState;
  bundle: ThemeBundle;
  onAges: () => void;
}) {
  // Progression is log-scaled chapters measured against cumulative unique
  // discoveries. "Ch N — X/Y → N+1". Daily runs instead track progress to
  // the win target, since that's what ends the run.
  const foundCount = state.found.length;
  const chapter = chapterIndex(foundCount);
  const curThreshold = chapterThreshold(chapter);
  const nextThreshold = chapterThreshold(chapter + 1);
  const inChapter = foundCount - curThreshold;
  const chapterSpan = nextThreshold - curThreshold;
  const finite = Number.isFinite(nextThreshold);
  const dailyTarget = state.mode === "daily" ? state.target : null;
  const dailyPct =
    dailyTarget != null
      ? Math.min(100, Math.round((foundCount / Math.max(1, dailyTarget)) * 100))
      : 0;
  const chapterPct = !finite
    ? 100
    : Math.min(100, Math.round((inChapter / Math.max(1, chapterSpan)) * 100));
  const pct = dailyTarget != null ? dailyPct : chapterPct;
  const ariaLabel =
    dailyTarget != null
      ? `Daily: ${foundCount} of ${dailyTarget} discoveries. Tap for details.`
      : finite
        ? `Chapter ${chapter + 1}. ${nextThreshold - foundCount} more unique finds to reach Chapter ${chapter + 2}. Tap for details.`
        : `Chapter ${chapter + 1} — open-ended. Tap for details.`;
  return (
    <div className="cbage" data-tour="chapter">
      <button
        type="button"
        className="cbageinfo"
        aria-label={ariaLabel}
        onClick={onAges}
      >
        <span className="bar">
          <i style={{ width: `${pct}%` }} />
          <span className="an">
            {dailyTarget != null ? "Daily" : `Ch ${chapter + 1}`}
          </span>
          <span className="nx">
            {dailyTarget != null
              ? `${foundCount}/${dailyTarget}`
              : finite
                ? `${inChapter}/${chapterSpan} → Ch ${chapter + 2}`
                : "Open-ended"}
          </span>
        </span>
      </button>
    </div>
  );
}
