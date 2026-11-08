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
  /** T-0217: current collection_version. Compared against the user's
   *  stored completion to decide whether to render the ✓ chip. */
  collectionVersion: number;
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
  /** T-0217 slice 3: theme codes the signed-in user has completed at the
   *  current `collectionVersion`. Renders a ✓ chip on matching tiles.
   *  Empty / undefined = no chips (signed-out or nothing completed yet). */
  completedThemes?: ReadonlySet<string>;
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
  /** Launch the guided tutorial. Unlike the other modes, the tutorial
   *  card bypasses the confirm flow — tapping it dismisses the sheet and
   *  starts a fresh scripted run on the "everything" bundle immediately,
   *  because the tutorial is cross-theme and single-shot. */
  onStartTutorial?: () => void;
  /** Whether the player has already finished the tutorial. Only affects
   *  the card's subtitle copy ("New? Learn the basics." vs "Replay the
   *  tutorial."). */
  tutorialSeen?: boolean;
}

export function ModeThemePicker({
  currentMode,
  currentDaily,
  currentTheme,
  dailyEnabled,
  themes,
  completedThemes,
  onDismiss,
  onConfirm,
  onRestart,
  onShareDaily,
  dailyDone,
  onStartTutorial,
  tutorialSeen = false,
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
        /* T-0217 slice 3: completion mark on themes the signed-in user has
           finished at the current collection_version. Corner chip, ink pill,
           quiet so it doesn't steal from the selected state. */
        .cbmtp .cbmtpTile.done { position: relative; }
        .cbmtp .cbmtpTileDone {
          position: absolute;
          top: -6px;
          right: -6px;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--ink);
          color: var(--bg);
          font-size: 11px;
          line-height: 18px;
          text-align: center;
          font-weight: 700;
          pointer-events: none;
          border: 1.5px solid var(--bg);
        }
        .cbmtp .cbmtpTile.on .cbmtpTileDone {
          background: var(--bg);
          color: var(--ink);
          border-color: var(--ink);
        }
        /* Tutorial card accent: matches the amber glow used by the live
           tutorial overlay (see .cbtut-overlay-spotlight in globals.css),
           so the "Learn" surface reads as the same visual language. */
        .cbmtp .cbmtpTutorial {
          border-color: var(--accent, #ffb800);
          box-shadow: 3px 3px 0 var(--accent, #ffb800);
        }
        .cbmtp .cbmtpTutorial:hover {
          box-shadow: 4px 4px 0 var(--accent, #ffb800);
        }
      `}</style>

      <span className="k">Mode</span>
      <div
        className="cbmtpModeRow"
        aria-label="Mode"
        style={{ ["--cbmtpModeCount" as string]: visibleModes.length + (onStartTutorial ? 1 : 0) }}
      >
        {visibleModes.map((m) => {
          const on = mode === m.k;
          return (
            <button
              key={m.k}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`Mode: ${m.name}`}
              className={`cbmtpTile cbmtpTileFit${on ? " on" : ""}`}
              onClick={() => setMode(m.k)}
            >
              <Pictogram name={`mode:${m.k}`} tier={m.tier} kind="object" pictogram={m.picto} />
              <b>{m.name}</b>
              <span className="t">{m.tag}</span>
            </button>
          );
        })}
        {onStartTutorial && (
          <button
            type="button"
            className="cbmtpTile cbmtpTileFit cbmtpTutorial"
            onClick={() => {
              onStartTutorial();
              onDismiss();
            }}
            aria-label={tutorialSeen ? "Replay tutorial" : "Start tutorial"}
          >
            <Pictogram
              name="mode:tutorial"
              tier="M"
              kind="object"
              // Open book pictogram.
              pictogram={`<path class="b" d="M4 7v18l12-3 12 3V7l-12 3z"/><path class="l" d="M16 10v18"/>`}
            />
            <b>Tutorial</b>
            <span className="t">
              {tutorialSeen ? "Replay the tutorial." : "New? Learn the basics."}
            </span>
          </button>
        )}
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
          const done = completedThemes?.has(t.code) ?? false;
          return (
            <button
              key={t.code}
              type="button"
              role="radio"
              aria-checked={on}
              className={`cbmtpTile${on ? " on" : ""}${done ? " done" : ""}`}
              onClick={() => setTheme(t.code)}
              disabled={dim}
              aria-label={done ? `${t.label}, completed` : t.label}
            >
              {done && (
                <span className="cbmtpTileDone" aria-hidden="true">✓</span>
              )}
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
