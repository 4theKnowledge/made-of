/**
 * Daily puzzle logic ported from legacy/made-of.html.
 *
 * The prototype generates a puzzle fresh each day from a deterministic seed.
 * We'd normally persist generated puzzles into `daily_puzzles` (phase 5 does
 * that), but for phase 3 we also derive today's puzzle on the fly so the
 * game works before the phase 5 job runs.
 *
 * CLOSED hubs: the 10 busiest non-fundamental items plus every fundamental.
 * This forces routes "the long way round" and matches the prototype exactly
 * (see artifact around line 1500 and line 2016).
 *
 * Server-side moves and hints keep the answer path private. The client only
 * ever learns:
 *   - is this step legal (adjacent, not closed)?
 *   - is this step closer / same / further from the goal (for ▲●▼ squares)?
 *   - optionally: the next hint id, when the user clicks Hint.
 *   - the full shortest path, when the user clicks Give up.
 */

import type { Snapshot } from "./snapshot";
import { shortestPath } from "./snapshot";

export interface Puzzle {
  /** yyyy-mm-dd (UTC). */
  date: string;
  /** Day number since the prototype's launch epoch (2026-10-27). */
  n: number;
  startId: string;
  goalId: string;
  par: number;
}

/**
 * Build the CLOSED set once per snapshot: all fundamental items plus the 10
 * busiest non-fundamentals by neighbour count.
 */
export function buildClosedSet(snap: Snapshot): Set<string> {
  const closed = new Set<string>();
  for (const n of snap.nodes.values()) if (n.tier === "F") closed.add(n.id);
  const byDegree = [...snap.nodes.values()]
    .filter((n) => n.tier !== "F")
    .sort((a, b) => b.neighbours.length - a.neighbours.length)
    .slice(0, 10);
  for (const n of byDegree) closed.add(n.id);
  return closed;
}

/** BFS respecting a closed set. Returns distance map from `from`. */
export function bfsOpen(
  snap: Snapshot,
  from: string,
  closed: Set<string>,
): Map<string, number> {
  const d = new Map<string, number>([[from, 0]]);
  if (!snap.nodes.has(from)) return d;
  const q = [from];
  while (q.length) {
    const x = q.shift()!;
    const node = snap.nodes.get(x)!;
    for (const nb of node.neighbours) {
      if (d.has(nb) || closed.has(nb)) continue;
      d.set(nb, d.get(x)! + 1);
      q.push(nb);
    }
  }
  return d;
}

/** Mulberry32 PRNG, ported from the prototype. */
export function mulberry32(seed: number): () => number {
  return function () {
    let a = seed | 0;
    a = (a + 0x6d2b79f5) | 0;
    seed = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash, ported from the prototype. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** yyyy-mm-dd in UTC. */
export function todayKeyUtc(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Day number since 2026-10-27 (the prototype's day #1). */
export function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) - Date.UTC(2026, 9, 27);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Generate a puzzle for a given date. Pure function of the snapshot and date.
 * Mirrors the artifact's makePuzzle: 300 attempts to find a pair 5-7 hops
 * apart; fall back to 4-hop pairs; last-resort fixed pair.
 */
export function generatePuzzle(
  snap: Snapshot,
  closed: Set<string>,
  date: string,
): Puzzle {
  const pool = [...snap.nodes.values()]
    .filter((n) => !closed.has(n.id))
    .map((n) => n.id);
  const rand = mulberry32(hashStr("madeof:" + date));
  const picked = tryPairs(snap, closed, pool, rand);
  const n = dayNumber(date);
  if (picked) {
    return { date, n, startId: picked.a, goalId: picked.b, par: picked.par };
  }
  // Fallback to a known pair.
  const fallbackStart = snap.nodes.has("sheep") ? "sheep" : pool[0];
  const fallbackGoal = snap.nodes.has("internet") ? "internet" : pool[pool.length - 1];
  const dist = bfsOpen(snap, fallbackStart, closed).get(fallbackGoal) ?? 1;
  return { date, n, startId: fallbackStart, goalId: fallbackGoal, par: dist };
}

function tryPairs(
  snap: Snapshot,
  closed: Set<string>,
  pool: string[],
  rand: () => number,
): { a: string; b: string; par: number } | null {
  for (let t = 0; t < 300; t++) {
    const a = pool[Math.floor(rand() * pool.length)];
    const d = bfsOpen(snap, a, closed);
    let candidates = pool.filter((x) => {
      const dx = d.get(x);
      return dx !== undefined && dx >= 5 && dx <= 7;
    });
    if (candidates.length === 0) {
      candidates = pool.filter((x) => d.get(x) === 4);
    }
    if (candidates.length > 0) {
      const b = candidates[Math.floor(rand() * candidates.length)];
      return { a, b, par: d.get(b)! };
    }
  }
  return null;
}

/** Return every legal next step from `fromId` (adjacent, not closed). */
export function legalMovesFrom(
  snap: Snapshot,
  closed: Set<string>,
  fromId: string,
): string[] {
  const node = snap.nodes.get(fromId);
  if (!node) return [];
  return node.neighbours.filter((n) => !closed.has(n));
}

/** True if `nextId` is a valid step from `fromId`. */
export function isLegalMove(
  snap: Snapshot,
  closed: Set<string>,
  fromId: string,
  nextId: string,
): boolean {
  if (closed.has(nextId)) return false;
  const node = snap.nodes.get(fromId);
  if (!node) return false;
  return node.neighbours.includes(nextId);
}

/**
 * Pick the next hint toward the goal: the adjacent open neighbour of `fromId`
 * whose distance to the goal is one less than fromId's. Alphabetical to make
 * the choice deterministic.
 */
export function nextHint(
  snap: Snapshot,
  closed: Set<string>,
  fromId: string,
  goalId: string,
): string | null {
  const distToGoal = bfsOpen(snap, goalId, closed);
  const dFrom = distToGoal.get(fromId);
  if (dFrom === undefined || dFrom === 0) return null;
  const node = snap.nodes.get(fromId);
  if (!node) return null;
  const candidates = node.neighbours
    .filter((n) => !closed.has(n) && distToGoal.get(n) === dFrom - 1)
    .sort();
  return candidates[0] ?? null;
}

/**
 * One shortest path respecting CLOSED, used only when the player gives up.
 * Delegates to the plain shortestPath (which already accepts a closed set).
 */
export function shortestPathClosed(
  snap: Snapshot,
  closed: Set<string>,
  from: string,
  to: string,
) {
  return shortestPath(snap, from, to, closed);
}
