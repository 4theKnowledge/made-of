import React from "react";
import type { MusicTrack } from "@/combine/storage";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";
import { Pictogram } from "@/pictograms/Pictogram";
import type { Tier } from "@/db/schema";

/**
 * Pictograms for each track. 32-unit grid matching `src/pictograms/data.ts`
 * (b = white body, l = ink line, k = solid ink, w = white line). These live
 * here (not in the main pictogram set) because tracks are a UI concept, not
 * items — no DB / seed role, no admin editing.
 */
const TRACK_PICTO: Record<MusicTrack, string> = {
  // Eighth note: a flag + stem + solid ink head.
  piano: `<path class="l" d="M12 6v16"/><path class="b" d="M12 6c6 1 9 4 9 8l-2-1c-1-2-3-4-7-5z"/><ellipse class="k" cx="9" cy="23" rx="4" ry="3"/>`,
  // Three hanging chimes under a bar.
  chimes: `<path class="l" d="M5 6h22"/><rect class="b" x="8" y="7" width="3" height="16" rx="1"/><rect class="b" x="14.5" y="7" width="3" height="20" rx="1"/><rect class="b" x="21" y="7" width="3" height="13" rx="1"/>`,
  // Three slow waves.
  drift: `<path class="l" d="M3 10c3-4 6 4 9 0s6 4 9 0 6 4 8 0M3 17c3-4 6 4 9 0s6 4 9 0 6 4 8 0M3 24c3-4 6 4 9 0s6 4 9 0 6 4 8 0"/>`,
  // Flame over a log/hearth.
  hearth: `<path class="b" d="M16 3c2 4 6 6 6 11a6 6 0 1 1-12 0c0-3 2-4 2-7 2 1 4 0 4-4z"/><path class="l" d="M16 14c1 2 3 3 3 5"/><rect class="b" x="4" y="24" width="24" height="4" rx="1"/><path class="l" d="M8 28v1M16 28v1M24 28v1"/>`,
  // Cloud with three raindrops.
  rainfall: `<path class="b" d="M8 16a5 5 0 0 1 5-5 5 5 0 0 1 9 2 4 4 0 0 1 1 8H9a4 4 0 0 1-1-5z"/><path class="l" d="M11 22l-2 5M17 22l-2 5M23 22l-2 5"/>`,
  // Muted speaker: speaker body + an X over the right side.
  off: `<path class="b" d="M4 13h5l6-5v18l-6-5H4z"/><path class="l" d="M20 12l7 8M27 12l-7 8"/>`,
};

/**
 * A soft tier colour per track. Picks fills from the existing pastel set so
 * tiles feel like the rest of the app without inventing new palette tokens.
 */
const TRACK_TIER: Record<MusicTrack, Tier> = {
  drift: "S",
  hearth: "P",
  piano: "F",
  rainfall: "C",
  chimes: "N",
  // Off gets the mineral/quartz tone — the palest and most neutral.
  off: "M",
};

const TRACK_META: Array<{ k: MusicTrack; name: string; tag: string }> = [
  { k: "drift", name: "Drift", tag: "Slow pads" },
  { k: "hearth", name: "Hearth", tag: "Low & warm" },
  { k: "piano", name: "Calm piano", tag: "Soft & roomy" },
  { k: "rainfall", name: "Rainfall", tag: "Rain + chord" },
  { k: "chimes", name: "Chimes", tag: "A bit busier" },
  { k: "off", name: "No music", tag: "Silent" },
];

export function SoundMenu({
  value,
  onChange,
  onDismiss,
}: {
  value: { music: MusicTrack; sfx: boolean; vol: number };
  onChange: (next: { music: MusicTrack; sfx: boolean; vol: number }) => void;
  onDismiss: () => void;
}) {
  return (
    <ResponsiveSheet
      open
      onDismiss={onDismiss}
      ariaLabel="Music and sound"
      className="cbsoundm"
    >
      <span className="k">Music</span>
      <div className="cbsoundgrid" role="radiogroup" aria-label="Music track">
        {TRACK_META.map(({ k, name, tag }) => {
          const on = value.music === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              className={`cbsoundtile${on ? " on" : ""}`}
              onClick={() => onChange({ ...value, music: k })}
            >
              <Pictogram
                name={`track:${k}`}
                tier={TRACK_TIER[k]}
                kind="object"
                pictogram={TRACK_PICTO[k]}
              />
              <b>{name}</b>
              <span className="t">{tag}</span>
            </button>
          );
        })}
      </div>
      <span className="k">Sound</span>
      <button
        type="button"
        className={`cbtopt cbsw${value.sfx ? " on" : ""}`}
        role="switch"
        aria-checked={value.sfx}
        onClick={() => onChange({ ...value, sfx: !value.sfx })}
      >
        <b>Sound effects</b>
        <span>{value.sfx ? "On" : "Off"}</span>
      </button>
      <label className="cbvol">
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={100}
          value={value.vol}
          onChange={(e) =>
            onChange({ ...value, vol: Number(e.currentTarget.value) })
          }
          aria-label="Volume"
        />
      </label>
      <button type="button" className="cbh cbback" onClick={onDismiss}>
        Done
      </button>
    </ResponsiveSheet>
  );
}
