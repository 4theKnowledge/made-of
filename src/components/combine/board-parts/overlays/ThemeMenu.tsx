import React, { useState } from "react";
import type { DailyResult } from "@/combine/storage";
import type { ThemeBundle, ThemeKey } from "@/combine/types";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";

export function ThemeMenu({
  bundles,
  daily,
  current,
  dailyDone,
  onPickTheme,
  onPickDaily,
  onShareDaily,
  onRestart,
  onDismiss,
}: {
  bundles: Record<ThemeKey, ThemeBundle>;
  daily: string | null;
  current: ThemeKey;
  dailyDone: DailyResult | null;
  onPickTheme: (which: ThemeKey) => void;
  onPickDaily: () => void;
  onShareDaily: () => void;
  onRestart: (which: ThemeKey) => void;
  onDismiss: () => void;
}) {
  const [confirmRestart, setConfirmRestart] = useState(false);
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
          return (
            <button
              key={key}
              type="button"
              className={`cbtopt${key === current && !daily ? " on" : ""}`}
              onClick={() => onPickTheme(key)}
            >
              <b>{b.theme.name}</b>
              <span>{b.theme.desc}</span>
              <em>{b.outputs.size} things to make</em>
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
            Restart {bundles[current].theme.name}
          </button>
        )}
        {!daily && confirmRestart && (
          <div className="cbrestartconfirm">
            <p>
              End this run and start a fresh {bundles[current].theme.name}
              {" "}game? Your current score and board will be lost.
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
                  onRestart(current);
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
