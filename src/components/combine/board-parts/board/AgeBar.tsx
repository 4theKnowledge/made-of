import React from "react";
import { ageNeed } from "@/combine/engine";
import type { GameState } from "@/combine/engine";
import { getGpOverrides } from "@/combine/gp-overrides";
import { chapterIndex, chapterThreshold } from "@/combine/progression";
import type { ThemeBundle } from "@/combine/types";

export function AgeBar({
  state,
  bundle,
  onAges,
}: {
  state: GameState;
  bundle: ThemeBundle;
  onAges: () => void;
}) {
  const softMode = getGpOverrides().mode === "soft";
  const ages = bundle.theme.ages;

  // Soft mode: progression is log-scaled chapters measured against
  // cumulative unique discoveries. The banded "Age I 0/14 → II" reading
  // doesn't apply; show "Ch N — X/Y → N+1" instead.
  if (softMode) {
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

  const last = state.age >= ages.length - 1;
  const need = ageNeed(state.age, bundle);
  const pct = last ? 100 : Math.min(100, Math.round((state.ageMade / need) * 100));
  const ariaLabel = `Age ${ages[state.age]} of ${ages.length}${
    last ? "" : `. Make ${need - state.ageMade} more Age ${ages[state.age]} combos to reach Age ${ages[state.age + 1]}`
  }. Tap for details.`;
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
          <span className="an">{ages[state.age]}</span>
          <span className="nx">
            {last ? "Final age" : `${state.ageMade}/${need} → ${ages[state.age + 1]}`}
          </span>
        </span>
      </button>
    </div>
  );
}
