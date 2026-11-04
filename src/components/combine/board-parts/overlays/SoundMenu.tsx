import React from "react";
import type { MusicTrack } from "@/combine/storage";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";

export function SoundMenu({
  value,
  onChange,
  onDismiss,
}: {
  value: { music: MusicTrack; sfx: boolean; vol: number };
  onChange: (next: { music: MusicTrack; sfx: boolean; vol: number }) => void;
  onDismiss: () => void;
}) {
  const tracks: Array<[MusicTrack, string, string]> = [
    ["drift", "Drift", "Slow pads, low stimulation"],
    ["piano", "Calm piano", "Slow, soft and roomy"],
    ["chimes", "Chimes", "Gentle and a bit busier"],
    ["off", "No music", ""],
  ];
  return (
    <ResponsiveSheet
      open
      onDismiss={onDismiss}
      ariaLabel="Music and sound"
      className="cbsoundm"
    >
      <span className="k">Music</span>
      {tracks.map(([k, n, d]) => (
        <button
          key={k}
          type="button"
          className={`cbtopt${value.music === k ? " on" : ""}`}
          onClick={() => onChange({ ...value, music: k })}
        >
          <b>{n}</b>
          {d && <span>{d}</span>}
        </button>
      ))}
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
      <button
        type="button"
        className="cbh cbback"
        onClick={onDismiss}
      >
        Done
      </button>
    </ResponsiveSheet>
  );
}
