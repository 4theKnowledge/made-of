/**
 * Deterministic RNG used by every game-affecting choice in Combine.
 *
 * The engine keeps a 32-bit int `rs` in game state. Every call to `rand()`
 * mutates `rs` and returns a float in [0, 1). The same state → the same
 * sequence, which is what lets saved games resume and the daily game be
 * identical across players.
 *
 * `Math.random()` is reserved for visual and audio variation only (sparkle
 * phases, note pitches). Anything that moves game state must go through
 * this module.
 *
 * Ports `cbRand` + `cbHash` from legacy/made-of.html lines 3199–3201.
 */

/** An opaque 32-bit integer that evolves as the RNG is called. */
export type RngState = { rs: number };

export function makeRng(seed: number): RngState {
  return { rs: seed | 0 };
}

/** Mulberry32 — small, fast, decent distribution for games. */
export function rand(state: RngState): number {
  let t = (state.rs = (state.rs + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function randInt(state: RngState, n: number): number {
  return Math.floor(rand(state) * n);
}

/** Pick one element uniformly. Returns undefined for empty inputs. */
export function pick<T>(state: RngState, arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[randInt(state, arr.length)];
}

/**
 * FNV-1a 32-bit hash of a string. Used to seed the daily game from the
 * local YYYY-MM-DD date, so every player plays the same board on the same
 * day. Not a cryptographic hash — just needs to be stable and spread out.
 */
export function fnv1a(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x | 0;
}

/** The daily seed: `madeof:combine:YYYY-MM-DD` → 32-bit int. */
export function dailySeed(localDate: string): number {
  return fnv1a("madeof:combine:" + localDate);
}

/** Produce a non-reproducible seed for endless games. Uses Math.random on
 *  purpose — endless does not need to be reproducible across players. */
export function freshEndlessSeed(): number {
  return (Math.random() * 4294967296) | 0;
}
