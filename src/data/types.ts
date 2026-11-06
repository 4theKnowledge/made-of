/**
 * Canonical types for the knowledge base.
 *
 * Two layers:
 *   - `Data*` shapes are what humans edit in `*.data.ts`. Optional fields can
 *     be omitted when empty, so a lean item is just a few lines.
 *   - `Loaded*` shapes are what the seed and tests consume. Omitted fields
 *     are normalised to empty arrays / null, so downstream code never has to
 *     deal with optional noise.
 */

import type {
  Confidence,
  EvidenceStance,
  ItemKind,
  LinkType,
  SourceKind,
  Tier,
} from "../db/schema";

/* --------------------------------- tags --------------------------------- */

/**
 * Membership markers on items. Tags are closed (not freeform) so the compiler
 * catches typos, grep finds every use, and renaming a tag is one Edit away.
 *
 * Membership lives *on the item* — this is what lets different modes
 * (Combine themes, future classroom/kitchen modes, etc.) all read the same
 * data without maintaining parallel allow-lists.
 */
export type Tag =
  /** Legacy marker from the Everyday theme (food, home, craft, clothes…).
   *  The theme has been retired; the tag is kept so item data still parses
   *  and so a future scoped theme can reuse it. */
  | "combine-everyday"

  // --- Reusable categories (available to any mode) ---
  /** Part of the semiconductor fab chain. */
  | "fab-chain";

/* -------------------------- hand-edited shapes --------------------------- */

export interface DataRecipe {
  label?: string | null;
  f?: string[];
  w?: string[];
  n?: string[];
  e?: string[];
}

export interface DataItem {
  name: string;
  /** Pinned slug. Omit and it derives from `name`. **Set this before
   *  renaming an item** — the slug is the identity anchor for the item's
   *  UUIDv5 (see `itemIdForSlug` in `src/data/rows.ts`), and changing it
   *  on a reseed will prune the old row and cascade-delete any
   *  discoveries/reports attached to it. Stick the old slug here when
   *  renaming and the identity carries over. */
  slug?: string;
  tier: Tier;
  kind: ItemKind;
  firstAppeared?: string | null;
  symbol?: string | null;
  fact?: string;
  /** SVG inner-markup for this item's pictogram. 32×32 viewBox,
   *  allowlisted elements/attrs/classes only. See
   *  docs/PICTOGRAM-STYLE.md or /api/admin/bulk/pictogram-style. */
  pictogram?: string | null;
  recipes?: DataRecipe[];
  linksN?: string[];
  linksS?: string[];
  /** When true, Combine never deals or makes this item regardless of theme
   *  membership. Safety net for items in the graph that should never land
   *  on the board (big bang, abstract placeholders). Omit for false. */
  isCombineExcluded?: boolean;
  /** Membership markers (see Tag). Omit when empty. */
  tags?: Tag[];
}

export interface DataEvidenceEntry {
  type: string;
  stance: EvidenceStance;
  summary: string;
  sources?: string[];
}

export interface DataEvidenceLink {
  ids: string[];
  confidence: Confidence;
  note?: string;
  evidence?: DataEvidenceEntry[];
}

export interface DataSource {
  kind: SourceKind;
  title: string;
  authors?: string | null;
  year?: number | null;
  published?: string | null;
  url?: string | null;
}

/* ---------------------------- normalised shapes --------------------------- */

/** The five link kinds that may appear in a recipe. `s` is item-level only. */
export type RecipeLinkKey = "f" | "w" | "n" | "e";

/** All five link kinds. `s` is only ever an item-level link. */
export type AnyLinkKey = RecipeLinkKey | "s";

export interface LoadedYear {
  /** Years before 2026 (the knowledge base's "now"). */
  ya: number;
  label: string;
  short: string;
}

export interface LoadedRecipe {
  label: string | null;
  f: string[];
  w: string[];
  n: string[];
  e: string[];
}

export interface LoadedItem {
  /** The lowercase display name (may contain spaces). */
  name: string;
  slug: string;
  tier: Tier;
  kind: ItemKind;
  firstAppeared: string | null;
  firstAppearedYears: LoadedYear | null;
  symbol: string | null;
  fact: string;
  recipes: LoadedRecipe[];
  /** Item-level links. Only `n` and `s` are legal here. */
  itemLinks: { n: string[]; s: string[] };
  /** Excluded from every Combine theme. Defaults to false. */
  isCombineExcluded: boolean;
  /** Membership markers. Always present (empty array if none). */
  tags: Tag[];
}

export interface LoadedEvidenceEntry {
  type: string;
  stance: EvidenceStance;
  summary: string;
  sources: string[];
}

export interface LoadedEvidenceLink {
  /** Each id is of the form "child<type<parent". */
  ids: string[];
  confidence: Confidence;
  note: string;
  evidence: LoadedEvidenceEntry[];
}

export interface LoadedSource {
  id: string;
  kind: SourceKind;
  title: string;
  authors: string | null;
  year: number | null;
  published: string | null;
  url: string | null;
}

export interface LoadedKnowledgeBase {
  items: LoadedItem[];
  evidenceLinks: LoadedEvidenceLink[];
  sources: LoadedSource[];
}

/** The three parts of an evidence link id. */
export interface LinkIdParts {
  childName: string;
  type: LinkType;
  parentName: string;
}
