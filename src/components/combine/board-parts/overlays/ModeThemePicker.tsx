"use client";

/**
 * Mode + theme picker sheet. Matches SoundMenu's horizontally-scrolling
 * tile pattern: one row of mode tiles (Endless / Fast / Daily), one row of
 * theme tiles (published only). Daily tile greys out the theme row because
 * daily is always the admin-configured host theme.
 *
 * Confirm navigates via URL: /combine?t=<code>. Theme switching reloads
 * the page so the server can build the right per-theme bundles.
 */

import React, { useMemo, useState } from "react";
import type { Mode } from "@/combine/types";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";
import { useConfirm } from "@/components/common/useConfirm";
import { Pictogram } from "@/pictograms/Pictogram";
import type { Tier } from "@/db/schema";

export interface PickerTheme {
  code: string;
  label: string;
  description: string | null;
  pictogram: string | null;
}

type PickerMode = "endless" | "fast" | "daily";

const MODE_META: Array<{
  k: PickerMode;
  name: string;
  tag: string;
  tier: Tier;
  picto: string;
}> = [
  {
    k: "endless",
    name: "Endless",
    tag: "Long run, collect, unlock",
    tier: "N",
    // Infinity loop
    picto: `<path class="l" d="M6 16c0-4 3-6 6-6s4 2 6 4 4 4 6 4 4-2 4-4-1-4-4-4-5 2-6 4-4 4-6 4-6-2-6-6"/>`,
  },
  {
    k: "fast",
    name: "Fast",
    tag: "Score-only, 2-part recipes",
    tier: "P",
    // Lightning bolt
    picto: `<path class="k" d="M18 3l-11 15h7l-2 11 11-15h-7z"/>`,
  },
  {
    k: "daily",
    name: "Daily",
    tag: "Same for everyone · one go",
    tier: "C",
    // Calendar
    picto: `<rect class="b" x="5" y="7" width="22" height="22" rx="2"/><path class="l" d="M5 13h22M10 4v6M22 4v6"/><rect class="k" x="10" y="17" width="4" height="4"/>`,
  },
];

/** Default theme pictogram when a theme has no custom one. A simple
 *  stacked-books / collection icon. */
const DEFAULT_THEME_PICTO =
  `<rect class="b" x="4" y="7" width="24" height="5" rx="1"/>` +
  `<rect class="b" x="4" y="14" width="24" height="5" rx="1"/>` +
  `<rect class="b" x="4" y="21" width="24" height="5" rx="1"/>` +
  `<path class="l" d="M9 9v1M9 16v1M9 23v1"/>`;

interface Props {
  currentMode: Mode;
  currentDaily: string | null;
  currentTheme: string;
  dailyEnabled: boolean;
  themes: PickerTheme[];
  onDismiss: () => void;
  /** Called with the chosen (mode, themeCode). Daily picks pass the daily
   *  host theme and the caller ignores themeCode for daily. */
  onConfirm: (mode: PickerMode, themeCode: string) => void;
  /** Restart the current run (current mode + theme). Only shown when the
   *  player hasn't changed their selection away from what's running. */
  onRestart?: () => void;
  /** Share today's daily result. Only shown while viewing Daily mode and
   *  the daily is actually done. */
  onShareDaily?: () => void;
  dailyDone?: boolean;
}

export function ModeThemePicker({
  currentMode,
  currentDaily,
  currentTheme,
  dailyEnabled,
  themes,
  onDismiss,
  onConfirm,
  onRestart,
  onShareDaily,
  dailyDone,
}: Props) {
  const initialMode: PickerMode = currentDaily ? "daily" : currentMode === "fast" ? "fast" : "endless";
  const [mode, setMode] = useState<PickerMode>(initialMode);
  const [theme, setTheme] = useState<string>(currentTheme);

  const visibleModes = useMemo(
    () => (dailyEnabled ? MODE_META : MODE_META.filter((m) => m.k !== "daily")),
    [dailyEnabled],
  );

  const dirty = mode !== initialMode || theme !== currentTheme;
  const confirmLabel =
    mode === "daily"
      ? "Play today's daily"
      : `Play ${mode === "fast" ? "Fast" : "Endless"} · ${
          themes.find((t) => t.code === theme)?.label ?? theme
        }`;

  const canConfirm = mode === "daily" || themes.some((t) => t.code === theme);
  const { confirm, dialog: confirmDialog } = useConfirm();

  return (
    <ResponsiveSheet
      open
      onDismiss={onDismiss}
      ariaLabel="Choose a mode and theme"
      className="cbmtp"
    >
      <style>{`
        .cbmtp .cbmtpRow {
          display: flex;
          gap: 10px;
          overflow-x: auto;
          padding: 2px 2px 8px;
          scroll-snap-type: x proximity;
          -webkit-overflow-scrolling: touch;
        }
        .cbmtp .cbmtpRow::-webkit-scrollbar { height: 6px; }
        .cbmtp .cbmtpRow::-webkit-scrollbar-thumb {
          background: var(--line);
          border-radius: 3px;
        }
        /* Mode row: fit all tiles across the available width without
           horizontal scroll. Each tile takes an equal share. */
        .cbmtp .cbmtpModeRow {
          display: grid;
          grid-template-columns: repeat(var(--cbmtpModeCount, 3), minmax(0, 1fr));
          gap: 8px;
          padding: 2px 2px 8px;
        }
        .cbmtp .cbmtpTile {
          flex: 0 0 auto;
          min-width: 120px;
          max-width: 160px;
          scroll-snap-align: start;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 10px 8px 8px;
          border: 2px solid var(--ink);
          border-radius: 4px;
          background: var(--surface);
          color: var(--ink);
          font: inherit;
          cursor: pointer;
          box-shadow: 3px 3px 0 var(--ink);
          transition: transform .1s;
          text-align: center;
        }
        /* Mode-row tiles: no fixed width — shrink to fit the grid cell. */
        .cbmtp .cbmtpTileFit {
          min-width: 0;
          max-width: none;
          padding: 8px 4px 6px;
        }
        .cbmtp .cbmtpTileFit b { font-size: 12px; }
        .cbmtp .cbmtpTileFit .t { font-size: 10px; }
        .cbmtp .cbmtpTile:hover {
          transform: translate(-1px,-1px);
          box-shadow: 4px 4px 0 var(--ink);
        }
        .cbmtp .cbmtpTile.on {
          background: var(--ink);
          color: var(--bg);
        }
        .cbmtp .cbmtpTile.on .t { color: inherit; opacity: .75; }
        .cbmtp .cbmtpTile:disabled {
          opacity: .4;
          cursor: not-allowed;
        }
        .cbmtp .cbmtpTile b { font-size: 13px; line-height: 1.1; }
        .cbmtp .cbmtpTile .t { font-size: 11px; color: var(--muted); line-height: 1.2; }
        .cbmtp .k {
          display: block;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--muted);
          margin: 10px 2px 6px;
        }
        .cbmtp .cbmtpConfirm {
          margin-top: 14px;
          width: 100%;
        }
      `}</style>

      <span className="k">Mode</span>
      <div
        className="cbmtpModeRow"
        role="radiogroup"
        aria-label="Mode"
        style={{ ["--cbmtpModeCount" as string]: visibleModes.length }}
      >
        {visibleModes.map((m) => {
          const on = mode === m.k;
          return (
            <button
              key={m.k}
              type="button"
              role="radio"
              aria-checked={on}
              className={`cbmtpTile cbmtpTileFit${on ? " on" : ""}`}
              onClick={() => setMode(m.k)}
            >
              <Pictogram name={`mode:${m.k}`} tier={m.tier} kind="object" pictogram={m.picto} />
              <b>{m.name}</b>
              <span className="t">{m.tag}</span>
            </button>
          );
        })}
      </div>

      <span className="k">
        Theme
        {mode === "daily" && (
          <span style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>
            — fixed to today&rsquo;s daily
          </span>
        )}
      </span>
      <div className="cbmtpRow" role="radiogroup" aria-label="Theme">
        {themes.length === 0 && (
          <span style={{ padding: 10, fontSize: 13, color: "var(--muted)" }}>
            No themes published yet.
          </span>
        )}
        {themes.map((t) => {
          const on = t.code === theme && mode !== "daily";
          const dim = mode === "daily";
          return (
            <button
              key={t.code}
              type="button"
              role="radio"
              aria-checked={on}
              className={`cbmtpTile${on ? " on" : ""}`}
              onClick={() => setTheme(t.code)}
              disabled={dim}
            >
              <Pictogram
                name={`theme:${t.code}`}
                tier="M"
                kind="object"
                pictogram={t.pictogram ?? DEFAULT_THEME_PICTO}
              />
              <b>{t.label}</b>
              <span className="t">{t.description ?? ""}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="cbh cbmtpConfirm"
        onClick={() => onConfirm(mode, theme)}
        disabled={!canConfirm || !dirty}
        style={{
          padding: "10px 14px",
          border: "1.5px solid var(--ink)",
          borderRadius: 3,
          background: canConfirm && dirty ? "var(--ink)" : "var(--surface)",
          color: canConfirm && dirty ? "var(--bg)" : "var(--muted)",
          cursor: canConfirm && dirty ? "pointer" : "default",
          fontWeight: 600,
        }}
      >
        {dirty ? confirmLabel : "Already playing this"}
      </button>
      {!dirty && onRestart && mode !== "daily" && (
        <button
          type="button"
          className="cbh"
          onClick={async () => {
            if (
              await confirm({
                title: "Restart this run?",
                body: "Score and board will be lost.",
                confirmLabel: "Restart",
                destructive: true,
              })
            ) {
              onRestart();
            }
          }}
          style={{ marginTop: 6, width: "100%" }}
        >
          Restart current run
        </button>
      )}
      {!dirty && onShareDaily && mode === "daily" && dailyDone && (
        <button
          type="button"
          className="cbh"
          onClick={onShareDaily}
          style={{ marginTop: 6, width: "100%" }}
        >
          Share today&rsquo;s result
        </button>
      )}

      <button
        type="button"
        className="cbh cbback"
        onClick={onDismiss}
        style={{ marginTop: 6, width: "100%" }}
      >
        Close
      </button>
      {confirmDialog}
    </ResponsiveSheet>
  );
}
