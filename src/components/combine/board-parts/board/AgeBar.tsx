import React from "react";
import { ageNeed } from "@/combine/engine";
import type { GameState } from "@/combine/engine";
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
  const ages = bundle.theme.ages;
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
