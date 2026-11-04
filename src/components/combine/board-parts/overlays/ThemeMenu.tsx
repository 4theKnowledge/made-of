import React, { useState } from "react";
import type { DailyResult } from "@/combine/storage";
import type { Mode, ThemeBundle, ThemeKey } from "@/combine/types";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";

export function ThemeMenu({
  bundles,
  fastBundles,
  mode,
  daily,
  current,
  dailyDone,
  onPickTheme,
  onPickDaily,
  onPickFast,
  onShareDaily,
  onRestart,
  onDismiss,
}: {
  bundles: Record<ThemeKey, ThemeBundle>;
  fastBundles: Record<ThemeKey, ThemeBundle>;
  mode: Mode;
  daily: string | null;
  current: ThemeKey;
  dailyDone: DailyResult | null;
  onPickTheme: (which: ThemeKey) => void;
  onPickDaily: () => void;
  onPickFast: (which: ThemeKey) => void;
  onShareDaily: () => void;
  onRestart: (which: ThemeKey, mode: Mode) => void;
  onDismiss: () => void;
}) {
  const [confirmRestart, setConfirmRestart] = useState(false);
  const modeLabel = mode === "fast" ? "Fast" : "Endless";
  const activeBundle = mode === "fast" ? fastBundles[current] : bundles[current];
  const themeName = activeBundle.theme.name;
  return (
    <ResponsiveSheet
      open
      onDismiss={onDismiss}
      ariaLabel="Choose a theme"
      className="cbthemes"
    >
      <span className="k">Today</span>
        {dailyDone ? (
          <div
            className="cbtopt cbdaily done"
            role="button"
            tabIndex={0}
            onClick={onPickDaily}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPickDaily();
              }
            }}
          >
            <b>Daily game · done · review</b>
            <span>
              {dailyDone.score.toLocaleString("en")} points · reached Age{" "}
              {dailyDone.ageName}. A new one tomorrow.
            </span>
            <button
              type="button"
              className="cbh"
              onClick={(e) => {
                e.stopPropagation();
                onShareDaily();
              }}
            >
              Share result
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`cbtopt cbdaily${daily ? " on" : ""}`}
            onClick={onPickDaily}
          >
            <b>Daily game{daily ? " · playing" : ""}</b>
            <span>
              Same start and same tiles for everyone today. One go. 6×6.
            </span>
          </button>
        )}
        <span className="k">Endless</span>
        {(Object.keys(bundles) as ThemeKey[]).map((key) => {
          const b = bundles[key];
          const on = key === current && !daily && mode === "classic";
          return (
            <button
              key={key}
              type="button"
              className={`cbtopt${on ? " on" : ""}`}
              onClick={() => onPickTheme(key)}
            >
              <b>{b.theme.name}</b>
              <span>{b.theme.desc}</span>
              <em>{b.outputs.size} things to make</em>
            </button>
          );
        })}
        <span className="k">Fast</span>
        {(Object.keys(fastBundles) as ThemeKey[]).map((key) => {
          const b = fastBundles[key];
          const on = key === current && !daily && mode === "fast";
          return (
            <button
              key={`fast-${key}`}
              type="button"
              className={`cbtopt cbfast${on ? " on" : ""}`}
              onClick={() => onPickFast(key)}
            >
              <b>{b.theme.name} · Fast</b>
              <span>
                Pair-only combos. Clear the board fast, chain hard, score high.
                No unlocks — leaderboards only.
              </span>
              <em>{b.recipes.length} pair recipes</em>
            </button>
          );
        })}
        <p className="sub">
          Games are saved as you go. Switching picks up where you left off.
        </p>
        {!daily && !confirmRestart && (
          <button
            type="button"
            className="cbh cbrestart"
            onClick={() => setConfirmRestart(true)}
            style={{ width: "100%", justifyContent: "center" }}
          >
            Restart {modeLabel} · {themeName}
          </button>
        )}
        {!daily && confirmRestart && (
          <div className="cbrestartconfirm">
            <p>
              End this run and start a fresh {modeLabel} · {themeName} game?
              Your current score and board will be lost.
              {mode === "fast"
                ? " Your best score stays put."
                : " Your collection stays put."}
            </p>
            <div className="cbrestartrow">
              <button
                type="button"
                className="cbh"
                onClick={() => setConfirmRestart(false)}
                style={{ flex: 1, justifyContent: "center" }}
              >
                Keep playing
              </button>
              <button
                type="button"
                className="cbh cbrestart"
                onClick={() => {
                  setConfirmRestart(false);
                  onRestart(current, mode);
                }}
                style={{ flex: 1, justifyContent: "center" }}
              >
                Restart
              </button>
            </div>
          </div>
        )}
      <button
        type="button"
        className="cbh cbback"
        onClick={onDismiss}
      >
        Cancel
      </button>
    </ResponsiveSheet>
  );
}
