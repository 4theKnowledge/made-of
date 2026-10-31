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
  tier: Tier;
  kind: ItemKind;
  firstAppeared?: string | null;
  symbol?: string | null;
  fact?: string;
  recipes?: DataRecipe[];
  linksN?: string[];
  linksS?: string[];
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
