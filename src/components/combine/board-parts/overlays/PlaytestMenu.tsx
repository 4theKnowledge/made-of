"use client";

import React, { useState } from "react";
import {
  getGpOverrides,
  setGpOverride,
  type ProgressionMode,
} from "@/combine/gp-overrides";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";
import { track } from "@/lib/analytics/track";

/** In-game experiments panel (T-0166). Only mounted when
 *  `NEXT_PUBLIC_COMBINE_PLAYTEST=1` — the TopBar gates it. Toggling writes
 *  through gp-overrides' setter and fires a PostHog event. Changes take
 *  effect on the next new game; the sheet shows a reminder nudge. */
export function PlaytestMenu({ onDismiss }: { onDismiss: () => void }) {
  const [current, setCurrent] = useState(() => getGpOverrides());
  const [nudge, setNudge] = useState(false);

  const setMode = (mode: ProgressionMode) => {
    const from = current.mode;
    if (from === mode) return;
    setGpOverride("mode", mode);
    setCurrent({ ...current, mode });
    setNudge(true);
    track({
      name: "combine_playtest_set",
      properties: { key: "mode", from, to: mode },
    });
  };

  const setTray = (tray: 3 | 4) => {
    const from = current.traySize;
    if (from === tray) return;
    setGpOverride("traySize", tray);
    setCurrent({ ...current, traySize: tray });
    setNudge(true);
    track({
      name: "combine_playtest_set",
      properties: { key: "tray", from: String(from), to: String(tray) },
    });
  };

  const modeMeta: Array<{ k: ProgressionMode; label: string; desc: string }> = [
    { k: "banded", label: "Banded", desc: "Age-locked (default)" },
    { k: "soft", label: "Soft bands", desc: "Grows as you discover" },
    { k: "flat", label: "Flat", desc: "Full pool, no gating" },
  ];

  const trayMeta: Array<{ k: 3 | 4; label: string; desc: string }> = [
    { k: 3, label: "3 tiles", desc: "Default" },
    { k: 4, label: "4 tiles", desc: "Wider choice" },
  ];

  return (
    <ResponsiveSheet
      open
      onDismiss={onDismiss}
      ariaLabel="Experimental gameplay settings"
      className="cbsoundm"
    >
      <span className="k">Progression mode</span>
      <div className="cbsoundgrid" role="radiogroup" aria-label="Progression mode">
        {modeMeta.map(({ k, label, desc }) => {
          const on = current.mode === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              className={`cbsoundtile${on ? " on" : ""}`}
              onClick={() => setMode(k)}
            >
              <b>{label}</b>
              <span className="t">{desc}</span>
            </button>
          );
        })}
      </div>

      <span className="k">Tray size</span>
      <div className="cbsoundgrid" role="radiogroup" aria-label="Tray size">
        {trayMeta.map(({ k, label, desc }) => {
          const on = current.traySize === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              className={`cbsoundtile${on ? " on" : ""}`}
              onClick={() => setTray(k)}
            >
              <b>{label}</b>
              <span className="t">{desc}</span>
            </button>
          );
        })}
      </div>

      {nudge && (
        <p style={{ marginTop: "0.75rem", fontSize: "0.9rem", opacity: 0.8 }}>
          Changes apply on a new game. Restart the current run to try it.
        </p>
      )}

      <button type="button" className="cbh cbback" onClick={onDismiss}>
        Done
      </button>
    </ResponsiveSheet>
  );
}
