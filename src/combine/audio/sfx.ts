/**
 * Combine's sound effects. Each pack re-skins the same nine game events
 * with a different voice: Classic (piano/handpan matching the music),
 * Wood (dry damped knocks), Chime (handpan always, higher register), or
 * Off. The pack doubles as the on/off switch.
 */

import {
  duck,
  getContext,
  midiToFreq,
  openVerb,
  playHandpan,
  playHush,
  playKnock,
  playPiano,
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

/** Short-form duck shape per sfx. Short, hot hits get a quick 4 dB nudge;
 *  big moments (unlock / discover / age / over) hold longer and release
 *  more gently so the music doesn't pump back up under the arpeggio. */
function duckFor(kind: SfxKind): { db: number; hold: number; release: number } {
  switch (kind) {
    case "unlock":
      return { db: 6, hold: 400, release: 500 };
    case "discover":
    case "age":
    case "over":
      return { db: 5, hold: 300, release: 400 };
    case "fuse":
      return { db: 5, hold: 200, release: 320 };
    case "crumble":
      // Hush is a wash of noise — ducking the music under it fights the
      // mood. Skip the duck for crumble.
      return { db: 0, hold: 0, release: 0 };
    default:
      return { db: 4, hold: 60, release: 240 };
  }
}

/** Play one effect. `arg` is used by `fuse` to size the run (chain mult). */
export function fx(kind: SfxKind, arg?: number): void {
  const core = getContext();
  if (!core) return;
  const pack = core.settings.sfxPack;
  if (pack === "off") return;
  if (core.ctx.state === "suspended") {
    void core.ctx.resume().catch(() => {
      /* Safari rejects resume outside a gesture; next gesture retries. */
    });
  }
  const t = core.ctx.currentTime + 0.01;
  const S = paletteFor(core);
  const bus = core.fxBus;
  // Duck the music so the sfx stays legible. No-op for `off` music.
  const d = duckFor(kind);
  if (d.db > 0) duck(core, d.db, d.hold, d.release);
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
      playFuseRamp(core, t, S, bus, arg, "classic");
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
      // Low sub-strike under the first note gives game-over real weight.
      // The piano voice at half-freq (one octave down) + longer tail sits
      // below the arpeggio without muddying it.
      playPiano(core, S[0] * 0.5, t, 0.5, bus, 2.6);
      [9, 7, 5, 3, 0].forEach((s, k) =>
        strikeOn(S[s], t + k * 0.22, 0.45, 1.5),
      );
      return;
  }
}

/** Chain-aware fuse ramp — pitches climb through the scale, velocities
 *  grow across the run, and the final hit opens the reverb send so x5
 *  chains feel celebratory. Shape is shared across packs; voice differs.
 *
 *  - `arg` is the chain multiplier (1..∞). We cap at 5 hits — more than
 *    that isn't audibly distinct and gets in the way of the next sfx.
 *  - Velocity ramps 0.42 → 0.60 across the run.
 *  - Spacing shortens from 0.09 s at chain=1 to 0.07 s at chain=5 so long
 *    chains feel rolling rather than plodding.
 *  - Last hit of a chain ≥3 lands on a chord tone (highest reachable one
 *    in the scale) and opens the fxBus→verb send for 220 ms. */
function playFuseRamp(
  core: AudioCore,
  t: number,
  S: number[],
  bus: AudioNode,
  arg: number | undefined,
  pack: "classic" | "wood" | "chime",
): void {
  const n = Math.min(5, 1 + (arg ?? 1));
  const startIdx = 2 + Math.floor(Math.random() * 2);
  const spacing = 0.09 - (n - 1) * 0.005;
  // Chord-tone landing for the final hit of ≥3-chains: the current song
  // progression is in CHORDS[0] (Dmaj7) ≈ the scale's root cluster. Rather
  // than threading music.ts chord state in here (which would couple sfx to
  // music), approximate by snapping to an index that lines up with the
  // tonic cluster — indices 7 (fifth) / 9 (octave) always resolve inside
  // our two palettes (PENTA and KURD).
  for (let k = 0; k < n; k++) {
    const isLast = k === n - 1;
    const idx = isLast && n >= 3
      ? 9
      : Math.min(S.length - 1, startIdx + k);
    const vel = 0.42 + (0.60 - 0.42) * (n === 1 ? 1 : k / (n - 1));
    const freq = S[idx];
    const when = t + k * spacing;
    if (pack === "wood") {
      playKnock(core, freq, when, vel + 0.1, bus, 0.16 + (isLast ? 0.04 : 0));
    } else if (pack === "chime") {
      // Chime's palette is an octave up; keep that here.
      playHandpan(core, freq * 2, when, vel, bus, 1.4 + (isLast ? 0.4 : 0));
    } else {
      strike(core, freq, when, vel, bus, 0.9 + (isLast ? 0.4 : 0));
    }
  }
  if (n >= 3) {
    // Open the fx→verb send on the last hit so the big chain finishes in a
    // bigger room. Timed to coincide with the landing note.
    const openAt = (n - 1) * spacing;
    setTimeout(() => openVerb(core, 2.4, 220), Math.max(0, openAt * 1000));
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
      playFuseRamp(core, t, S, bus, arg, "wood");
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
      // Low sub-strike underneath — Wood keeps the knock timbre but uses a
      // longer, lower one for weight.
      playKnock(core, low[0] * 0.5, t, 0.6, bus, 0.42);
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
      // Chime pack calls playFuseRamp with its own palette (`S`, not
      // `high`); the shared ramp does the octave-up internally when
      // pack === "chime".
      playFuseRamp(core, t, S, bus, arg, "chime");
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
      // Low sub-ring an octave below the scale's root, with a very long
      // tail — Chime's weighty bell at the bottom of the carillon.
      ring(S[0], t, 0.42, 3.0);
      [9, 7, 5, 3, 0].forEach((s, k) =>
        ring(high[s], t + k * 0.24, 0.4, 2.0),
      );
      return;
  }
}

function pick<T>(a: readonly T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}
