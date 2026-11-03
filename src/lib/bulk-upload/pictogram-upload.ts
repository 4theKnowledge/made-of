/**
 * Pictograms-only upload channel.
 *
 * Two accepted shapes, both are JSON:
 *
 *   { "item name": "<svg...>", "kind-code": "<svg...>", ... }
 *   { "items": { "name": "<svg>" }, "kinds": { "code": "<svg>" } }
 *
 * The simple form resolves each key against existing items by name first,
 * then falls back to kinds by code. Ambiguous keys (a name that also
 * matches a kind code, which shouldn't happen in practice) are flagged as
 * an error so the admin can switch to the explicit form.
 *
 * The explicit form is unambiguous; items/kinds live under their own
 * top-level keys.
 *
 * Semantics match the bulk pack applier: pictograms are set when the DB
 * value is null OR when the admin opts into overwrite. Default is
 * "fill-when-empty"; the UI exposes an "overwrite" toggle per entry.
 */

import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { sanitisePictogram } from "@/pictograms/sanitise";

export type PictogramPayload =
  | Record<string, string>
  | {
      items?: Record<string, string>;
      kinds?: Record<string, string>;
    };

export type TargetKind = "item" | "kind";

export type EntryDisposition =
  /** Target found, DB pictogram is null — safe to insert. */
  | { kind: "fill_empty"; targetKind: TargetKind; targetKey: string; targetId: string }
  /** Target found, DB pictogram already set — admin must opt into overwrite. */
  | { kind: "would_overwrite"; targetKind: TargetKind; targetKey: string; targetId: string; existing: string }
  /** No target under either items.name or kinds.code. */
  | { kind: "orphan" }
  /** The key matches both an item name and a kind code. */
  | { kind: "ambiguous"; itemId: string; kindCode: string }
  /** The SVG failed sanitisation. */
  | { kind: "invalid_svg"; errors: string[] };

export interface PictogramEntry {
  /** The key as the admin wrote it. */
  sourceKey: string;
  /** The sanitised SVG string (normalised whitespace). Empty when invalid. */
  svg: string;
  disposition: EntryDisposition;
}

export interface PictogramPlan {
  entries: PictogramEntry[];
}

interface Lookups {
  itemByName: Map<string, { id: string; pictogram: string | null }>;
  kindByCode: Map<string, { pictogram: string | null }>;
}

async function loadLookups(): Promise<Lookups> {
  const db = getDb();
  const [items, kinds] = await Promise.all([
    db
      .select({
        id: schema.items.id,
        name: schema.items.name,
        pictogram: schema.items.pictogram,
      })
      .from(schema.items),
    db
      .select({ code: schema.kinds.code, pictogram: schema.kinds.pictogram })
      .from(schema.kinds),
  ]);
  const itemByName = new Map(items.map((i) => [i.name, { id: i.id, pictogram: i.pictogram }]));
  const kindByCode = new Map(kinds.map((k) => [k.code, { pictogram: k.pictogram }]));
  return { itemByName, kindByCode };
}

/** Normalise either shape to two dicts. Strips the `_readme` key the
 *  downloadable template carries, so an admin can paste the template
 *  as-is for a smoke test. */
function normaliseInput(payload: PictogramPayload): {
  items: Record<string, string>;
  kinds: Record<string, string>;
  usedExplicit: boolean;
} {
  const strip = (dict: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(dict)) {
      if (k.startsWith("_")) continue;
      out[k] = v;
    }
    return out;
  };

  if (payload && typeof payload === "object") {
    const asRec = payload as Record<string, unknown>;
    const hasExplicitItems =
      "items" in asRec && asRec.items !== null && typeof asRec.items === "object";
    const hasExplicitKinds =
      "kinds" in asRec && asRec.kinds !== null && typeof asRec.kinds === "object";
    if (hasExplicitItems || hasExplicitKinds) {
      return {
        items: strip((asRec.items as Record<string, string>) ?? {}),
        kinds: strip((asRec.kinds as Record<string, string>) ?? {}),
        usedExplicit: true,
      };
    }
  }
  return {
    items: strip(payload as Record<string, string>),
    kinds: {},
    usedExplicit: false,
  };
}

export async function planPictogramUpload(
  payload: PictogramPayload,
): Promise<PictogramPlan> {
  const { items, kinds, usedExplicit } = normaliseInput(payload);
  const lookups = await loadLookups();
  const entries: PictogramEntry[] = [];

  function classify(
    sourceKey: string,
    rawSvg: string,
    scope: "items" | "kinds" | "auto",
  ): PictogramEntry {
    if (typeof rawSvg !== "string") {
      return {
        sourceKey,
        svg: "",
        disposition: { kind: "invalid_svg", errors: ["Value is not a string."] },
      };
    }
    const sanitised = sanitisePictogram(rawSvg);
    if (!sanitised.ok) {
      return {
        sourceKey,
        svg: "",
        disposition: { kind: "invalid_svg", errors: sanitised.errors },
      };
    }

    const asItem = lookups.itemByName.get(sourceKey);
    const asKind = lookups.kindByCode.get(sourceKey);

    if (scope === "items") {
      if (!asItem) return { sourceKey, svg: sanitised.value, disposition: { kind: "orphan" } };
      return makeHit(sourceKey, sanitised.value, "item", asItem.id, asItem.pictogram);
    }
    if (scope === "kinds") {
      if (!asKind) return { sourceKey, svg: sanitised.value, disposition: { kind: "orphan" } };
      return makeHit(sourceKey, sanitised.value, "kind", sourceKey, asKind.pictogram);
    }
    // Auto-resolve: item first, then kind. Ambiguity when both match.
    if (asItem && asKind) {
      return {
        sourceKey,
        svg: sanitised.value,
        disposition: { kind: "ambiguous", itemId: asItem.id, kindCode: sourceKey },
      };
    }
    if (asItem) return makeHit(sourceKey, sanitised.value, "item", asItem.id, asItem.pictogram);
    if (asKind) return makeHit(sourceKey, sanitised.value, "kind", sourceKey, asKind.pictogram);
    return { sourceKey, svg: sanitised.value, disposition: { kind: "orphan" } };
  }

  for (const [key, svg] of Object.entries(items)) {
    entries.push(classify(key, svg, usedExplicit ? "items" : "auto"));
  }
  for (const [key, svg] of Object.entries(kinds)) {
    entries.push(classify(key, svg, "kinds"));
  }
  return { entries };
}

function makeHit(
  sourceKey: string,
  svg: string,
  targetKind: TargetKind,
  targetId: string,
  existing: string | null,
): PictogramEntry {
  if (existing === null || existing === "") {
    return {
      sourceKey,
      svg,
      disposition: { kind: "fill_empty", targetKind, targetKey: sourceKey, targetId },
    };
  }
  return {
    sourceKey,
    svg,
    disposition: {
      kind: "would_overwrite",
      targetKind,
      targetKey: sourceKey,
      targetId,
      existing,
    },
  };
}

export interface ApplyPictogramInput {
  payload: PictogramPayload;
  /** sourceKey → "insert" | "overwrite" | "skip". Default behaviour:
   *   fill_empty → insert, would_overwrite → skip, orphan/ambiguous/invalid → skip. */
  decisions: Record<string, "insert" | "overwrite" | "skip">;
  dryRun: boolean;
}

export interface ApplyPictogramResult {
  ok: boolean;
  dryRun: boolean;
  stats: {
    itemsSet: number;
    kindsSet: number;
    overwrites: number;
    skippedOrphan: number;
    skippedAmbiguous: number;
    skippedInvalid: number;
  };
  errors: string[];
}

export async function applyPictogramUpload(
  input: ApplyPictogramInput,
): Promise<ApplyPictogramResult> {
  const plan = await planPictogramUpload(input.payload);
  const stats = {
    itemsSet: 0,
    kindsSet: 0,
    overwrites: 0,
    skippedOrphan: 0,
    skippedAmbiguous: 0,
    skippedInvalid: 0,
  };
  const errors: string[] = [];
  const db = getDb();

  try {
    await db.transaction(async (tx) => {
      for (const entry of plan.entries) {
        const d = entry.disposition;
        const decision = input.decisions[entry.sourceKey] ?? defaultDecision(d);

        if (decision === "skip") {
          if (d.kind === "orphan") stats.skippedOrphan += 1;
          else if (d.kind === "ambiguous") stats.skippedAmbiguous += 1;
          else if (d.kind === "invalid_svg") stats.skippedInvalid += 1;
          continue;
        }
        if (d.kind === "orphan" || d.kind === "ambiguous" || d.kind === "invalid_svg") {
          // Can't do anything with these regardless of decision.
          if (d.kind === "orphan") stats.skippedOrphan += 1;
          else if (d.kind === "ambiguous") stats.skippedAmbiguous += 1;
          else stats.skippedInvalid += 1;
          continue;
        }
        if (d.kind === "would_overwrite" && decision !== "overwrite") {
          // Default (insert) on an existing value is a no-op; admin must
          // explicitly choose overwrite.
          continue;
        }

        if (d.targetKind === "item") {
          await tx
            .update(schema.items)
            .set({ pictogram: entry.svg, updatedAt: new Date() })
            .where(sql`${schema.items.id} = ${d.targetId}`);
          stats.itemsSet += 1;
        } else {
          await tx
            .update(schema.kinds)
            .set({ pictogram: entry.svg, updatedAt: new Date() })
            .where(sql`${schema.kinds.code} = ${d.targetId}`);
          stats.kindsSet += 1;
        }
        if (d.kind === "would_overwrite") stats.overwrites += 1;
      }

      if (input.dryRun) throw new DryRunRollback();
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) {
      errors.push(err instanceof Error ? err.message : String(err));
      return { ok: false, dryRun: input.dryRun, stats, errors };
    }
  }

  return { ok: true, dryRun: input.dryRun, stats, errors };
}

function defaultDecision(
  d: EntryDisposition,
): "insert" | "overwrite" | "skip" {
  if (d.kind === "fill_empty") return "insert";
  // would_overwrite / orphan / ambiguous / invalid_svg all default to skip.
  return "skip";
}

class DryRunRollback extends Error {
  constructor() {
    super("dry-run rollback");
    this.name = "DryRunRollback";
  }
}
