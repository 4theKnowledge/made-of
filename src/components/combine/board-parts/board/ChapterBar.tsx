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
  // Daily with a manifest reads manifest progress, not chapter progression
  // — the manifest is what ends the run, so chapters would be noise.
  // Legacy daily (null manifest) falls through to the endless path.
  const dailyManifest =
    state.mode === "daily" && state.manifest && state.manifest.length > 0
      ? state.manifest
      : null;
  if (dailyManifest) {
    const total = dailyManifest.length;
    const foundN = state.manifestFound.length;
    const pct = Math.min(100, Math.round((foundN / Math.max(1, total)) * 100));
    const done = foundN >= total;
    const ariaLabel = done
      ? `Daily complete — all ${total} items found. Tap for details.`
      : `Daily — ${foundN} of ${total} items found. Tap for details.`;
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
            <span className="an">Daily</span>
            <span className="nx">
              {done ? "Complete" : `${foundN}/${total} items found`}
            </span>
          </span>
        </button>
      </div>
    );
  }

  // Endless / fast / legacy-daily: log-scaled chapters measured against
  // cumulative unique discoveries. "Ch N — X/Y → N+1".
  const foundCount = state.found.length;
  const chapter = chapterIndex(foundCount);
  const curThreshold = chapterThreshold(chapter);
  const nextThreshold = chapterThreshold(chapter + 1);
  const inChapter = foundCount - curThreshold;
  const chapterSpan = nextThreshold - curThreshold;
  const finite = Number.isFinite(nextThreshold);
  const chapterPct = !finite
    ? 100
    : Math.min(100, Math.round((inChapter / Math.max(1, chapterSpan)) * 100));
  const pct = chapterPct;
  const ariaLabel = finite
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
          <span className="an">Ch {chapter + 1}</span>
          <span className="nx">
            {finite ? `${inChapter}/${chapterSpan} → Ch ${chapter + 2}` : "Open-ended"}
          </span>
        </span>
      </button>
    </div>
  );
}
