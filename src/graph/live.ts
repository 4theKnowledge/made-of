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
import { buildClosedSet } from "./link";

export interface LiveSnapshot {
  snapshot: Snapshot;
  /** Code map keyed by slug (not uuid), so the public API can stay slug-ish
   *  without ever exposing slugs directly. Resolve code -> slug -> node via
   *  `snapshot.bySlug`, or use the `codeForId` / `nodeByCode` helpers below. */
  itemCodes: CodeMap<string>;
  /** Code map keyed by link uuid. */
  linkCodes: CodeMap<string>;
  /** Item uuids closed in daily puzzles (fundamentals + 10 busiest hubs). */
  closed: Set<string>;
  /** Monotonic version id; bumped on every reload. */
  version: number;
  /** Code for an item uuid, going through the slug map. */
  codeForId(id: string): string | undefined;
  /** Node for a public code. */
  nodeByCode(code: string): import("./types").GraphNode | undefined;
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
  const itemCodes = buildCodeMap(
    [...snapshot.nodes.values()].map((n) => n.slug),
    slot.codeSeed,
  );
  const linkCodes = buildCodeMap(
    rows.links.map((l) => l.id!),
    slot.codeSeed + ":links",
  );
  const closed = buildClosedSet(snapshot);
  slot.version += 1;
  return makeLiveSnapshot({
    snapshot,
    itemCodes,
    linkCodes,
    closed,
    version: slot.version,
  });
}

type LiveSnapshotData = Omit<LiveSnapshot, "codeForId" | "nodeByCode">;

/** Attach the helper methods. Exported so tests can wrap an in-memory fixture. */
export function makeLiveSnapshot(data: LiveSnapshotData): LiveSnapshot {
  return {
    ...data,
    codeForId(id) {
      const slug = data.snapshot.nodes.get(id)?.slug;
      return slug ? data.itemCodes.toCode(slug) : undefined;
    },
    nodeByCode(code) {
      const slug = data.itemCodes.toId(code);
      return slug ? data.snapshot.bySlug.get(slug) : undefined;
    },
  };
}
