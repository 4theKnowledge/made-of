/**
 * Combine's sound effects. Each pack re-skins the same nine game events
 * with a different voice: Classic (piano/handpan matching the music),
 * Wood (dry damped knocks), Chime (handpan always, higher register), or
 * Off. The pack doubles as the on/off switch.
 */

import {
  getContext,
  midiToFreq,
  playHandpan,
  playHush,
  playKnock,
  strike,
  type AudioCore,
} from "./core";

/** D major pentatonic for the piano. */
const PENTA = [50, 57, 59, 62, 64, 66, 69, 71, 74, 76].map(midiToFreq);
/** D Kurd for chimes / drift / rainfall. */
const KURD = [
  146.83, 220.0, 233.08, 261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 523.25,
];

export type SfxKind =
  | "place"
  | "fuse"
  | "discover"
  | "unlock"
  | "age"
  | "ship"
  | "nope"
  | "crumble"
  | "over";

/** Pick the scale for the current music track. Piano + Hearth share the
 *  diatonic piano palette; the other tracks use the D Kurd scale so the
 *  handpan-voice sfx sit inside the same mode as the music. */
function paletteFor(core: AudioCore): number[] {
  const usePenta =
    core.settings.music === "piano" || core.settings.music === "hearth";
  return usePenta ? PENTA : KURD;
}

/** Play one effect. `arg` is used by `fuse` to size the run (chain mult). */
export function fx(kind: SfxKind, arg?: number): void {
  const core = getContext();
  if (!core) return;
  const pack = core.settings.sfxPack;
  if (pack === "off") return;
  if (core.ctx.state === "suspended") void core.ctx.resume();
  const t = core.ctx.currentTime + 0.01;
  const S = paletteFor(core);
  const bus = core.fxBus;
  if (pack === "wood") {
    playWood(core, kind, t, S, bus, arg);
  } else if (pack === "chime") {
    playChime(core, kind, t, S, bus, arg);
  } else {
    playClassic(core, kind, t, S, bus, arg);
  }
}

/* ========================================================================
 * Classic pack — unchanged from pre-pack behaviour.
 * ====================================================================== */
function playClassic(
  core: AudioCore,
  kind: SfxKind,
  t: number,
  S: number[],
  bus: AudioNode,
  arg?: number,
): void {
  const strikeOn = (freq: number, when: number, vel: number, len?: number) =>
    strike(core, freq, when, vel, bus, len);
  switch (kind) {
    case "place":
      strikeOn(pick(S.slice(5)), t, 0.32, 0.6);
      return;
    case "fuse": {
      const n = Math.min(5, 1 + (arg ?? 1));
      const s = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        strikeOn(S[Math.min(S.length - 1, s + k)], t + k * 0.09, 0.5, 0.9);
      }
      return;
    }
    case "discover":
      [3, 5, 7, 9].forEach((s, k) => strikeOn(S[s], t + k * 0.12, 0.5, 1.2));
      return;
    case "unlock":
      // Lifetime collection unlock — rarer than "discover" (age-find),
      // so a longer, louder, more resonant arpeggio with a high tail.
      [0, 3, 5, 7, 9, 9 + 2].forEach((s, k) =>
        strikeOn(S[Math.min(S.length - 1, s)], t + k * 0.11, 0.65, 1.8),
      );
      return;
    case "age":
      [0, 4, 6, 7, 8, 9].forEach((s, k) =>
        strikeOn(S[s], t + k * 0.14, 0.55, 1.4),
      );
      return;
    case "ship":
      strikeOn(S[9] * 2, t, 0.28, 0.7);
      return;
    case "nope":
      strikeOn(S[2], t, 0.35, 0.18);
      strikeOn(S[1], t + 0.1, 0.3, 0.18);
      return;
    case "crumble":
      playHush(core, t, 0.5);
      return;
    case "over":
      [9, 7, 5, 3, 0].forEach((s, k) =>
        strikeOn(S[s], t + k * 0.22, 0.45, 1.5),
      );
      return;
  }
}

/* ========================================================================
 * Wood pack — dry damped knocks. Percussive and tactile; sits well under
 * busy music because knocks don't ring out.
 * ====================================================================== */
function playWood(
  core: AudioCore,
  kind: SfxKind,
  t: number,
  S: number[],
  bus: AudioNode,
  arg?: number,
): void {
  // Knocks don't need the full scale — lean on the lower half so the pack
  // reads as "wooden" rather than "xylophone".
  const low = S.slice(0, 7);
  const knock = (freq: number, when: number, vel: number, len = 0.2) =>
    playKnock(core, freq, when, vel, bus, len);
  switch (kind) {
    case "place":
      knock(pick(low), t, 0.45, 0.14);
      return;
    case "fuse": {
      const n = Math.min(5, 1 + (arg ?? 1));
      const s = 2 + Math.floor(Math.random() * 2);
      for (let k = 0; k < n; k++) {
        // Gentle pitch rise through the run, louder on the final hit.
        knock(low[Math.min(low.length - 1, s + k)], t + k * 0.08, 0.55 + k * 0.04, 0.16);
      }
      return;
    }
    case "discover":
      [1, 3, 5, 6].forEach((s, k) =>
        knock(low[Math.min(low.length - 1, s)], t + k * 0.1, 0.55, 0.18),
      );
      return;
    case "unlock":
      // A longer run; final two knocks higher-pitched for a "clinch".
      [0, 2, 3, 5, 6, 6].forEach((s, k) =>
        knock(low[Math.min(low.length - 1, s)] * (k >= 4 ? 2 : 1), t + k * 0.09, 0.65, 0.2),
      );
      return;
    case "age":
      [0, 2, 3, 4, 5, 6].forEach((s, k) =>
        knock(low[Math.min(low.length - 1, s)], t + k * 0.12, 0.6, 0.22),
      );
      return;
    case "ship":
      // A single high dry tap.
      knock(low[low.length - 1] * 2, t, 0.4, 0.12);
      return;
    case "nope":
      knock(low[1], t, 0.5, 0.1);
      knock(low[0], t + 0.08, 0.45, 0.12);
      return;
    case "crumble":
      // Crumble is best as a noise whoosh regardless of pack — knocks can't
      // paint "a thing dissolving." Keep the shared hush.
      playHush(core, t, 0.5);
      return;
    case "over":
      [5, 4, 2, 1, 0].forEach((s, k) =>
        knock(low[Math.min(low.length - 1, s)], t + k * 0.18, 0.5, 0.26),
      );
      return;
  }
}

/* ========================================================================
 * Chime pack — handpan always, higher register, longer tails. Bell-like.
 * Ignores the music track's voice choice (always handpan) so the pack has
 * a consistent character even when Piano or Hearth is playing.
 * ====================================================================== */
function playChime(
  core: AudioCore,
  kind: SfxKind,
  t: number,
  S: number[],
  bus: AudioNode,
  arg?: number,
): void {
  // Shift everything up an octave so chimes sit above the music, not inside
  // it. Keep the top notes capped so they don't clip the ear.
  const high = S.map((f) => f * 2);
  const ring = (freq: number, when: number, vel: number, len = 1.6) =>
    playHandpan(core, freq, when, vel, bus, len);
  switch (kind) {
    case "place":
      // A single, delicate top-end ring.
      ring(pick(high.slice(5)), t, 0.28, 1.1);
      return;
    case "fuse": {
      const n = Math.min(5, 1 + (arg ?? 1));
      const s = 3 + Math.floor(Math.random() * 2);
      for (let k = 0; k < n; k++) {
        ring(high[Math.min(high.length - 1, s + k)], t + k * 0.1, 0.45, 1.4);
      }
      return;
    }
    case "discover":
      // Four ringing bells, long tails.
      [3, 5, 7, 9].forEach((s, k) => ring(high[s], t + k * 0.13, 0.45, 1.8));
      return;
    case "unlock":
      // Six bells, climbing, even longer tails for the lifetime moment.
      [0, 3, 5, 7, 9, 9].forEach((s, k) =>
        ring(high[Math.min(high.length - 1, s)], t + k * 0.12, 0.6, 2.2),
      );
      return;
    case "age":
      [0, 4, 6, 7, 8, 9].forEach((s, k) =>
        ring(high[s], t + k * 0.15, 0.5, 1.8),
      );
      return;
    case "ship":
      // Doubled: a short low ring under a very high ring, so terminal
      // shipments sound like a tiny carillon rather than one ping.
      ring(high[4], t, 0.25, 1.2);
      ring(high[9] * 2, t + 0.02, 0.3, 1.2);
      return;
    case "nope":
      // Two quick dampened rings — short `len` eats the tail.
      ring(high[2], t, 0.3, 0.3);
      ring(high[1], t + 0.1, 0.26, 0.3);
      return;
    case "crumble":
      playHush(core, t, 0.5);
      return;
    case "over":
      [9, 7, 5, 3, 0].forEach((s, k) =>
        ring(high[s], t + k * 0.24, 0.4, 2.0),
      );
      return;
  }
}

function pick<T>(a: readonly T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}
