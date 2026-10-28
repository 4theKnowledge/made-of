import type {
  Confidence,
  EvidenceStance,
  ItemKind,
  LinkType,
  SourceKind,
  Tier,
} from "../db/schema";

/** The five link kinds that may appear in a recipe. `s` is item-level only. */
export type RecipeLinkKey = "f" | "w" | "n" | "e";

/** All five link kinds. `s` is only ever an item-level link. */
export type AnyLinkKey = RecipeLinkKey | "s";

export interface ParsedYear {
  /** Years before 2026 (the artifact's "now"). */
  ya: number;
  label: string;
  short: string;
}

export interface ParsedRecipe {
  label: string | null;
  f: string[];
  w: string[];
  n: string[];
  e: string[];
}

export interface ParsedItem {
  /** The original lowercase name from DATA (may contain spaces). */
  name: string;
  slug: string;
  tier: Tier;
  kind: ItemKind;
  firstAppeared: string | null;
  firstAppearedYears: ParsedYear | null;
  symbol: string | null;
  fact: string;
  recipes: ParsedRecipe[];
  /** Item-level links. Only `n` and `s` are legal here. */
  itemLinks: { n: string[]; s: string[] };
}

export interface ParsedEvidenceEntry {
  type: string;
  stance: EvidenceStance;
  summary: string;
  sources: string[];
}

export interface ParsedEvidenceLink {
  /** Each id is of the form "child<type<parent". */
  ids: string[];
  confidence: Confidence;
  note: string;
  evidence: ParsedEvidenceEntry[];
}

export interface ParsedSource {
  id: string;
  kind: SourceKind;
  title: string;
  authors: string | null;
  year: number | null;
  published: string | null;
  url: string | null;
}

export interface ParsedPrototype {
  items: ParsedItem[];
  evidenceLinks: ParsedEvidenceLink[];
  sources: ParsedSource[];
}

/** The three parts of an evidence link id. */
export interface LinkIdParts {
  childName: string;
  type: LinkType;
  parentName: string;
}
