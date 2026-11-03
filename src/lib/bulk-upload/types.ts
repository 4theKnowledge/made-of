/**
 * Types for the bulk upload planner.
 *
 * A pack has the same shape as an admin export (DataItem[], DataEvidenceLink[],
 * Record<string, DataSource>) so a snapshot of the KB is a valid pack and
 * can round-trip. The planner consumes a pack + a projection of the current
 * KB and produces a Plan: a decision list the admin confirms, plus the
 * concrete additive operations that will run on apply.
 */

import type {
  DataEvidenceLink,
  DataItem,
  DataSource,
} from "@/data/types";

/** Admin-authored kind entry inside a pack. Lets a pack introduce a new
 *  kind (e.g. "fossil") together with its fallback pictogram, so new
 *  items referencing that kind can land in one upload. Omit when a pack
 *  only reuses existing kinds. */
export interface DataKind {
  /** Human-readable label (sentence case). */
  label?: string;
  description?: string | null;
  /** SVG inner-markup for the kind's fallback pictogram. */
  pictogram?: string | null;
}

export interface BulkPack {
  items: DataItem[];
  evidenceLinks: DataEvidenceLink[];
  sources: Record<string, DataSource>;
  /** New kinds introduced by this pack (keyed by kind code). Optional. */
  kinds?: Record<string, DataKind>;
}

/** Minimum DB projection the planner needs. Loaded once per plan request so
 *  the pure planner functions don't need DB access. */
export interface KbIndex {
  /** All existing items keyed by name (lowercased, as names are stored
   *  lowercase in this KB). */
  itemByName: Map<string, { id: string; slug: string; name: string }>;
  /** All existing items keyed by slug. Separate because new pack items
   *  derive their slugs, which might collide with an existing slug under a
   *  different name. */
  itemBySlug: Map<string, { id: string; slug: string; name: string }>;
  /** All source codes already in use. */
  existingSourceCodes: Set<string>;
  /** All existing kind codes (so pack items can validate against them
   *  without a hard-coded list). */
  existingKindCodes: Set<string>;
}

export type IssueSeverity = "error" | "warning";

export interface Issue {
  severity: IssueSeverity;
  /** Short machine code, e.g. "duplicate_name_in_pack", for grouping and
   *  later localisation. */
  code: string;
  /** Human-readable message rendered in the review UI. */
  message: string;
  /** Where the issue applies, if known — item name, source code, or
   *  evidence id. Lets the UI link the message back to the pack. */
  at?: string;
}

/** How a pack item relates to the DB. */
export type ItemDisposition =
  /** No existing item with the same name or slug — insert as new. */
  | { kind: "new" }
  /** An item with the same name exists. Admin must choose how to resolve. */
  | { kind: "name_collision"; existingItemId: string }
  /** The derived slug collides with a different existing item (e.g. pack
   *  item "Red Oak" normalises to the slug of an existing "red oak"). */
  | { kind: "slug_collision"; existingItemId: string; existingName: string }
  /** A soft match: a different pack name but a near-identical normalised
   *  form (e.g. "red-oak" vs "red oak"). Not a hard collision; shown as a
   *  merge candidate for the admin to review. */
  | {
      kind: "fuzzy_match";
      existingItemId: string;
      existingName: string;
      /** The normalised form that caused the match. */
      normalisedKey: string;
    };

/** Resolution the admin selects for a collision/candidate. */
export type ItemDecision =
  /** Default for `new`: just insert it. */
  | "insert"
  /** Skip this pack item entirely. References to it elsewhere in the pack
   *  resolve to the existing item under the same name. */
  | "skip"
  /** Merge: add this pack item's new recipes/links/tags to the existing
   *  item. Editorial fields (fact, tier, kind, symbol, firstAppeared) are
   *  left alone — merging is additive only. */
  | "merge";

export interface ItemPlanEntry {
  /** Pack item name (as given by the author). */
  name: string;
  /** The slug the planner would use when inserting. */
  slug: string;
  /** Classification against the DB. */
  disposition: ItemDisposition;
  /** The admin's chosen resolution. The planner picks a sensible default
   *  (insert for new, merge for name_collision, insert for slug_collision —
   *  which will then error on apply if the admin doesn't change it to
   *  skip/merge). */
  decision: ItemDecision;
}

export interface SourcePlanEntry {
  code: string;
  /** "new" when the pack code is unknown to the DB; "exists" when the DB
   *  already has it (in which case the pack entry is ignored — we don't
   *  overwrite source metadata). */
  disposition: "new" | "exists";
}

export interface Plan {
  items: ItemPlanEntry[];
  sources: SourcePlanEntry[];
  /** Count of evidence rows that would be inserted on apply, assuming the
   *  current decisions. Updated when the admin flips a decision. */
  evidenceCount: number;
  /** Count of link rows (recipe + item level) that would be inserted. */
  linkCount: number;
  /** All validation findings. The UI blocks apply when any `error` is
   *  present. */
  issues: Issue[];
}
