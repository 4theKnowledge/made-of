/**
 * Live snapshot singleton used by API route handlers.
 *
 * The snapshot is loaded lazily on first access. In production it is pinned
 * in memory for the life of the Node process; reloading goes through
 * `reloadSnapshot()`, which is wired up to Postgres LISTEN/NOTIFY in a later
 * phase (phase 5 content publish).
 */

import { randomBytes } from "node:crypto";
import { loadRowsFromDb } from "./load";
import { buildSnapshot, type Snapshot } from "./snapshot";
import { buildCodeMap, type CodeMap } from "./codes";
import { buildClosedSet } from "./daily";

export interface LiveSnapshot {
  snapshot: Snapshot;
  itemCodes: CodeMap<string>;
  linkCodes: CodeMap<string>;
  /** Items closed in daily puzzles (fundamentals + 10 busiest hubs). */
  closed: Set<string>;
  /** Monotonic version id; bumped on every reload. */
  version: number;
}

/**
 * Next.js dev (and sometimes prod with bundle splitting) can instantiate a
 * module twice in the same process. Pin cross-request state to globalThis so
 * every route handler sees the same snapshot and the same code seed.
 */
type Globals = typeof globalThis & {
  __madeOfLive?: {
    current: LiveSnapshot | null;
    loading: Promise<LiveSnapshot> | null;
    version: number;
    codeSeed: string;
  };
};
const g = globalThis as Globals;
g.__madeOfLive ??= {
  current: null,
  loading: null,
  version: 0,
  codeSeed: process.env.CODE_SEED ?? randomBytes(16).toString("hex"),
};
const slot = g.__madeOfLive;

export async function getLiveSnapshot(): Promise<LiveSnapshot> {
  if (slot.current) return slot.current;
  if (slot.loading) return slot.loading;
  slot.loading = buildLive().then((snap) => {
    slot.current = snap;
    slot.loading = null;
    return snap;
  });
  return slot.loading;
}

/** Rebuild from Postgres and swap atomically. */
export async function reloadSnapshot(): Promise<LiveSnapshot> {
  const snap = await buildLive();
  slot.current = snap;
  return snap;
}

/** Test seam. */
export function setLiveSnapshotForTesting(snap: LiveSnapshot | null) {
  slot.current = snap;
  slot.loading = null;
}

async function buildLive(): Promise<LiveSnapshot> {
  const rows = await loadRowsFromDb({ liveOnly: true });
  const snapshot = buildSnapshot(rows);
  const itemCodes = buildCodeMap([...snapshot.nodes.keys()], slot.codeSeed);
  const linkCodes = buildCodeMap(
    rows.links.map((l) => l.id),
    slot.codeSeed + ":links",
  );
  const closed = buildClosedSet(snapshot);
  slot.version += 1;
  return { snapshot, itemCodes, linkCodes, closed, version: slot.version };
}
