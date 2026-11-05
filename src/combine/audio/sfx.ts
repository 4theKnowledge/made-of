/**
 * Combine's sound effects. One function per event, each a short strike or
 * run of strikes on the current scale (D major pentatonic with piano
 * music; D Kurd with chimes or drift).
 */

import { getContext, midiToFreq, playHush, strike } from "./core";

/** D major pentatonic for the piano. */
const PENTA = [50, 57, 59, 62, 64, 66, 69, 71, 74, 76].map(midiToFreq);
/** D Kurd for chimes / drift. */
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

/** Play one effect. `arg` is used by `fuse` to size the run (chain mult). */
export function fx(kind: SfxKind, arg?: number): void {
  const core = getContext();
  if (!core) return;
  if (!core.settings.sfx) return;
  if (core.ctx.state === "suspended") void core.ctx.resume();
  const t = core.ctx.currentTime + 0.01;
  const S = core.settings.music === "piano" ? PENTA : KURD;
  const bus = core.fxBus;
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
      // Six notes climbing instead of four, velocities ramped up.
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

function pick<T>(a: readonly T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}
