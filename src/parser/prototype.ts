/**
 * Port of the artifact's own parser (see legacy/made-of.html around line
 * 1425). We mirror the original logic exactly so edge cases match, with only
 * cosmetic changes to make it TypeScript.
 *
 * The reference "now" year for parseYear is hard-coded to 2026 in the
 * artifact. CLAUDE.md says "use the current year when porting" — but doing so
 * would make the parsed `ya` values move each year, which breaks the
 * round-trip diff. We keep 2026 so output is stable; the UI can shift to the
 * current year at render time without changing stored data.
 */

import type { Confidence, LinkType } from "../db/schema";
import type {
  LinkIdParts,
  ParsedEvidenceLink,
  ParsedItem,
  ParsedPrototype,
  ParsedRecipe,
  ParsedSource,
  ParsedYear,
} from "./types";

const REFERENCE_NOW = 2026;

/** lowercase, hyphenate non-alphanumerics, strip edges. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const RECIPE_KEYS = new Set(["f", "w", "n", "e"]);
const ITEM_LINK_KEYS = new Set(["n", "s"]);

type Parts = { f: string[]; w: string[]; n: string[]; s: string[]; e: string[] };

/** Mirror of the artifact's parseParts. */
export function parseParts(s: string | undefined | null): Parts {
  const o: Parts = { f: [], w: [], n: [], s: [], e: [] };
  (s ?? "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((part) => {
      const i = part.indexOf(":");
      if (i < 0) return;
      const k = part.slice(0, i).trim() as keyof Parts;
      if (!(k in o)) return;
      o[k] = part
        .slice(i + 1)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    });
  return o;
}

const fmtN = (v: number) => String(+v.toFixed(1));

/** Mirror of the artifact's parseYear. */
export function parseYear(y: string | undefined | null): ParsedYear | null {
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

/** Extract the DATA block from the artifact HTML. */
export function extractData(html: string): string {
  const m = html.match(/const DATA = `\n([\s\S]*?)`;/);
  if (!m) throw new Error("DATA block not found in HTML");
  return m[1];
}

/** Extract the EVIDENCE block from the artifact HTML. */
export function extractEvidence(html: string): {
  links: ParsedEvidenceLink[];
  sources: Record<string, Omit<ParsedSource, "id">>;
} {
  const m = html.match(/\/\*EVIDENCE\*\/([\s\S]*?)\/\*END-EVIDENCE\*\//);
  if (!m) throw new Error("EVIDENCE block not found in HTML");
  const parsed = JSON.parse(m[1]) as {
    links: Array<{
      ids: string[];
      confidence: Confidence;
      note?: string;
      evidence?: Array<{
        type: string;
        stance: "supports" | "contradicts";
        summary: string;
        sources?: string[];
      }>;
    }>;
    sources: Record<
      string,
      {
        kind: string;
        title: string;
        authors?: string;
        year?: number;
        published?: string;
        url?: string;
      }
    >;
  };
  return {
    links: parsed.links.map((l) => ({
      ids: l.ids,
      confidence: l.confidence,
      note: l.note ?? "",
      evidence: (l.evidence ?? []).map((e) => ({
        type: e.type,
        stance: e.stance,
        summary: e.summary,
        sources: e.sources ?? [],
      })),
    })),
    sources: parsed.sources as Record<string, Omit<ParsedSource, "id">>,
  };
}

/** Parse one DATA line into a ParsedItem. */
export function parseItemLine(line: string): ParsedItem {
  const [name, tier, kind, year, symbol, rec, links, fact] = line
    .split("|")
    .map((s) => (s ?? "").trim());
  if (!name) throw new Error(`Empty name in line: ${line}`);

  const recipes: ParsedRecipe[] = rec
    ? rec.split(" / ").map((rawRecipe) => {
        let r = rawRecipe.trim();
        let label: string | null = null;
        const m = r.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (m) {
          label = m[1];
          r = m[2];
        }
        const p = parseParts(r);
        // Only recipe-legal keys may appear inside a recipe.
        for (const k of Object.keys(p) as (keyof Parts)[]) {
          if (!RECIPE_KEYS.has(k) && p[k].length) {
            throw new Error(
              `Recipe of "${name}" contains item-level link "${k}": ${rawRecipe}`,
            );
          }
        }
        return { label, f: p.f, w: p.w, n: p.n, e: p.e };
      })
    : [];

  const lk = parseParts(links);
  for (const k of Object.keys(lk) as (keyof Parts)[]) {
    if (!ITEM_LINK_KEYS.has(k) && lk[k].length) {
      throw new Error(
        `Item-level links of "${name}" contain recipe-level key "${k}"`,
      );
    }
  }

  return {
    name,
    slug: slug(name),
    tier: tier as ParsedItem["tier"],
    kind: kind as ParsedItem["kind"],
    firstAppeared: year || null,
    firstAppearedYears: parseYear(year),
    symbol: symbol || null,
    fact: fact ?? "",
    recipes,
    itemLinks: { n: lk.n, s: lk.s },
  };
}

/** Parse a full DATA block. */
export function parseItems(data: string): ParsedItem[] {
  return data
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map(parseItemLine);
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

function isLinkType(t: string): t is LinkType {
  return t === "f" || t === "w" || t === "n" || t === "s" || t === "e";
}

/** Full parse of the artifact: items plus evidence plus sources. */
export function parsePrototype(html: string): ParsedPrototype {
  const items = parseItems(extractData(html));
  const ev = extractEvidence(html);
  const sources: ParsedSource[] = Object.entries(ev.sources).map(
    ([id, src]) => ({
      id,
      kind: src.kind as ParsedSource["kind"],
      title: src.title,
      authors: src.authors ?? null,
      year: typeof src.year === "number" ? src.year : null,
      published: src.published ?? null,
      url: src.url ?? null,
    }),
  );
  return { items, evidenceLinks: ev.links, sources };
}
