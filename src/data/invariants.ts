/**
 * Graph-shape invariants.
 *
 * Two mechanical guardrails the KB must satisfy at all times:
 *
 *   1. **Every item reaches `big bang`.** It's the only acceptable upstream
 *      dead-end — everything else must have at least one chain of
 *      `recipes.*.{f,w,n,e}` edges leading back to it. Islanded items break
 *      the thematic premise of Made Of.
 *
 *   2. **No dead-end raws in any Combine theme.** A theme item that has no
 *      incoming recipes AND is only used as input to 1-input (promote)
 *      recipes can never participate in a combine — it clutters the board.
 *
 * `auditGraph` is pure over a `Snapshot`. Callers rebuild the snapshot from
 * fresh row state (CI tests, admin mutation seams, server boot) and inspect
 * the returned lists. `formatAudit` turns a non-empty audit into the
 * multi-line message shape the dead-end-raw test used to emit — now shared
 * with API 422 responses and the boot-time warning.
 */

import { buildSnapshot, type Snapshot } from "../graph/snapshot";
import { buildThemeBundle } from "../combine/data";
import type { ThemeKey } from "../combine/types";
import { loadRowsFromDb, type DbExecutor } from "../graph/load";

export interface Orphan {
  id: string;
  name: string;
  tier: string;
  kind: string;
}

export interface DeadEndRaw {
  theme: string;
  id: string;
  name: string;
  outputs: string[];
}

export interface GraphAudit {
  orphans: Orphan[];
  deadEndRaws: DeadEndRaw[];
}

export function isCleanAudit(audit: GraphAudit): boolean {
  return audit.orphans.length === 0 && audit.deadEndRaws.length === 0;
}

/**
 * Run both invariant checks against `snapshot`. `themes` defaults to
 * `["everything"]` — expand once more themes exist.
 *
 * If `big bang` is missing from the snapshot entirely, every item is
 * reported as an orphan and the dead-end-raw pass still runs independently.
 */
export function auditGraph(
  snapshot: Snapshot,
  themes: ThemeKey[] = ["everything"],
): GraphAudit {
  return {
    orphans: findOrphans(snapshot),
    deadEndRaws: findDeadEndRaws(snapshot, themes),
  };
}

function findOrphans(snapshot: Snapshot): Orphan[] {
  const bigBang = snapshot.byName.get("big bang");
  if (!bigBang) {
    // Everything is orphaned by definition. Caller should treat a missing
    // big-bang node as the top-priority failure, but we still return the
    // full list so the message surfaces it concretely.
    const all: Orphan[] = [];
    for (const n of snapshot.nodes.values()) {
      all.push({ id: n.id, name: n.name, tier: n.tier, kind: n.kind });
    }
    all.sort((a, b) => a.name.localeCompare(b.name));
    return all;
  }

  const reach = new Set<string>([bigBang.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of snapshot.nodes.values()) {
      if (reach.has(n.id)) continue;
      for (const edge of n.up) {
        if (reach.has(edge.id)) {
          reach.add(n.id);
          changed = true;
          break;
        }
      }
    }
  }

  const orphans: Orphan[] = [];
  for (const n of snapshot.nodes.values()) {
    if (!reach.has(n.id)) {
      orphans.push({ id: n.id, name: n.name, tier: n.tier, kind: n.kind });
    }
  }
  orphans.sort((a, b) => a.name.localeCompare(b.name));
  return orphans;
}

function findDeadEndRaws(
  snapshot: Snapshot,
  themes: ThemeKey[],
): DeadEndRaw[] {
  const out: DeadEndRaw[] = [];
  for (const theme of themes) {
    const bundle = buildThemeBundle(snapshot, theme);
    const inPool = new Set<string>();
    for (const r of bundle.recipes) {
      for (const id of r.all) inPool.add(id);
      inPool.add(r.out);
    }
    for (const id of inPool) {
      if (bundle.outputs.has(id)) continue;
      const usedIn = bundle.recipes.filter((r) => r.all.includes(id));
      if (usedIn.length === 0) continue;
      const maxSize = Math.max(...usedIn.map((r) => r.all.length));
      if (maxSize !== 1) continue;
      const name = bundle.items.get(id)?.name ?? id;
      const outputs = usedIn
        .map((r) => bundle.items.get(r.out)?.name ?? r.out)
        .sort();
      out.push({ theme, id, name, outputs });
    }
  }
  out.sort((a, b) =>
    a.theme === b.theme
      ? a.name.localeCompare(b.name)
      : a.theme.localeCompare(b.theme),
  );
  return out;
}

/**
 * Rebuild the snapshot from current DB state (seeing uncommitted writes
 * when `executor` is a transaction handle) and run `auditGraph` against
 * it. Reads *all* items — draft/review/live — because an orphan at
 * draft status is still a bug waiting to go live.
 *
 * Call this from inside a transaction right before commit: if the
 * returned audit is non-empty, throw to roll back and surface the audit
 * in the 422 response.
 */
export async function auditDb(executor: DbExecutor): Promise<GraphAudit> {
  const rows = await loadRowsFromDb({ liveOnly: false, executor });
  const snapshot = buildSnapshot(rows);
  return auditGraph(snapshot);
}

/**
 * Thrown from inside a transaction when the audit fails, so the tx rolls
 * back. Callers catch this at the route boundary and return 422 with the
 * attached audit.
 */
export class InvariantViolation extends Error {
  readonly audit: GraphAudit;
  constructor(audit: GraphAudit) {
    super(formatAudit(audit));
    this.name = "InvariantViolation";
    this.audit = audit;
  }
}

/**
 * Render a non-empty audit as a human-readable multi-line message.
 * The shape intentionally matches the previous dead-end-raw test errors so
 * CI output is unchanged, and 422 bodies can reuse the same text.
 */
export function formatAudit(audit: GraphAudit): string {
  const parts: string[] = [];
  if (audit.orphans.length > 0) {
    parts.push(
      `${audit.orphans.length} item(s) have no upstream path to "big bang":`,
      ...audit.orphans.map((o) => `  ${o.name} (${o.tier}/${o.kind})`),
      "",
      'Author at least one upstream recipe edge on each (e.g. `recipes: [{ e: ["mammals"] }]`)',
      "so the item chains back to the big bang.",
    );
  }
  if (audit.deadEndRaws.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push(
      `Found ${audit.deadEndRaws.length} dead-end raw item(s) in Combine themes:`,
      ...audit.deadEndRaws.map(
        (o) =>
          `  [${o.theme}] "${o.name}" is only used in 1-input promotes to: ${o.outputs.join(", ")}`,
      ),
      "",
      'Author at least one ingredient recipe (e.g. `recipes: [{ e: ["land plants"] }]`)',
      "on each offender so Combine can place it in a sensible band.",
    );
  }
  return parts.join("\n");
}
