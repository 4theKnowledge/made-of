/**
 * Load the hand-edited knowledge base and normalise it to the shape the
 * seed, snapshot and tests consume.
 */

import type { LinkType } from "../db/schema";
import type {
  DataEvidenceEntry,
  DataEvidenceLink,
  DataItem,
  DataSource,
  LinkIdParts,
  LoadedEvidenceEntry,
  LoadedEvidenceLink,
  LoadedItem,
  LoadedKnowledgeBase,
  LoadedRecipe,
  LoadedSource,
  LoadedYear,
} from "./types";
import { ITEMS } from "./items.data";
import { EVIDENCE_LINKS, SOURCES } from "./evidence.data";

const REFERENCE_NOW = 2026;

/** lowercase, hyphenate non-alphanumerics, strip edges. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const fmtN = (v: number) => String(+v.toFixed(1));

/** Convert a stored year string ("13.8bya", "1994", "-3500") to its parsed
 *  form. Null-safe. */
export function parseYear(y: string | undefined | null): LoadedYear | null {
  let raw = (y ?? "").trim();
  if (!raw || raw === "?") return null;
  let circa = false;
  if (raw[0] === "~") {
    circa = true;
    raw = raw.slice(1);
  }
  let ya: number;
  let label: string;
  let short: string;
  if (/bya$/.test(raw)) {
    const v = parseFloat(raw);
    ya = v * 1e9;
    label = `${fmtN(v)} billion years ago`;
    short = `${fmtN(v)} bn yrs ago`;
  } else if (/mya$/.test(raw)) {
    const v = parseFloat(raw);
    ya = v * 1e6;
    label = `${fmtN(v)} million years ago`;
    short = `${fmtN(v)} m yrs ago`;
  } else if (/ka$/.test(raw)) {
    const v = parseFloat(raw);
    ya = v * 1e3;
    label = `${(v * 1000).toLocaleString("en")} years ago`;
    short = `${(v * 1000).toLocaleString("en")} yrs ago`;
  } else {
    const v = parseInt(raw, 10);
    ya = Math.max(REFERENCE_NOW - v, 0);
    label =
      v < 0
        ? `${(-v).toLocaleString("en")} BCE`
        : `${v}${v < 1000 ? " CE" : ""}`;
    short = label;
  }
  if (circa) {
    label = (/ago$/.test(label) ? "About " : "c. ") + label;
    short = "c. " + short;
  }
  return { ya, label, short };
}

function isLinkType(t: string): t is LinkType {
  return t === "f" || t === "w" || t === "n" || t === "s" || t === "e";
}

/** Split an evidence link id "child<type<parent" into parts. */
export function parseLinkId(id: string): LinkIdParts {
  const parts = id.split("<");
  if (parts.length !== 3) {
    throw new Error(`Malformed evidence link id: ${id}`);
  }
  const [childName, type, parentName] = parts;
  if (!isLinkType(type)) {
    throw new Error(`Unknown link type in id ${id}: ${type}`);
  }
  return { childName, type, parentName };
}

export function normaliseItem(it: DataItem): LoadedItem {
  const recipes: LoadedRecipe[] = (it.recipes ?? []).map((r) => ({
    label: r.label ?? null,
    f: r.f ?? [],
    w: r.w ?? [],
    n: r.n ?? [],
    e: r.e ?? [],
  }));
  return {
    name: it.name,
    // Pinned slug wins; fall back to derivation from name. See DataItem.slug
    // for why pinning matters (identity anchor for UUIDv5 item ids).
    slug: it.slug ?? slug(it.name),
    tier: it.tier,
    kind: it.kind,
    firstAppeared: it.firstAppeared ?? null,
    firstAppearedYears: parseYear(it.firstAppeared ?? null),
    symbol: it.symbol ?? null,
    fact: it.fact ?? "",
    recipes,
    itemLinks: { n: it.linksN ?? [], s: it.linksS ?? [] },
    tags: it.tags ?? [],
  };
}

function normaliseEvidenceEntry(e: DataEvidenceEntry): LoadedEvidenceEntry {
  return {
    type: e.type,
    stance: e.stance,
    summary: e.summary,
    sources: e.sources ?? [],
  };
}

function normaliseEvidenceLink(l: DataEvidenceLink): LoadedEvidenceLink {
  return {
    ids: l.ids,
    confidence: l.confidence,
    note: l.note ?? "",
    evidence: (l.evidence ?? []).map(normaliseEvidenceEntry),
  };
}

function normaliseSource(id: string, s: DataSource): LoadedSource {
  return {
    id,
    kind: s.kind,
    title: s.title,
    authors: s.authors ?? null,
    year: s.year ?? null,
    published: s.published ?? null,
    url: s.url ?? null,
  };
}

/** Load the full knowledge base. */
export function loadKnowledgeBase(): LoadedKnowledgeBase {
  const items = ITEMS.map(normaliseItem);
  const evidenceLinks = EVIDENCE_LINKS.map(normaliseEvidenceLink);
  const sources = Object.entries(SOURCES).map(([id, s]) =>
    normaliseSource(id, s),
  );
  return { items, evidenceLinks, sources };
}

/** Lookup by display name (the key used inside evidence ids and recipe parts). */
export function itemsByName(kb: LoadedKnowledgeBase): Map<string, LoadedItem> {
  const m = new Map<string, LoadedItem>();
  for (const it of kb.items) m.set(it.name, it);
  return m;
}
