/**
 * Convert a `LoadedKnowledgeBase` into the rows that will be inserted into
 * Postgres.
 *
 * Row ids are uuids assigned at build time, so the DB foreign keys don't
 * carry names. **Item ids are derived from slug via UUIDv5** so the same
 * slug always resolves to the same uuid across runs — otherwise a reseed
 * would cascade-delete every user's `combine_discoveries` row (and anything
 * else FK'd to items). Recipes/links/evidence/sources stay random; they're
 * only referenced by other seeded rows that get wiped and reinserted
 * together.
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  LinkType,
  NewItem,
  NewLink,
  NewLinkEvidence,
  NewRecipe,
  NewSource,
} from "../db/schema";
import { parseLinkId } from "./load";
import type { LoadedEvidenceLink, LoadedKnowledgeBase } from "./types";

export interface SeedRows {
  items: NewItem[];
  recipes: NewRecipe[];
  links: Array<NewLink & { hasEvidence?: boolean }>;
  linkEvidence: NewLinkEvidence[];
  evidenceSources: Array<{
    evidenceId: string;
    sourceId: string;
    position: number;
  }>;
  sources: NewSource[];
  /** Combine theme memberships, item id → theme codes. Populated when reading
   *  from the DB; empty when building from the knowledge base file (the file
   *  format pre-dates themes-as-a-table). */
  combineThemesByItem?: Map<string, string[]>;
  /** name → item uuid. Only populated when building rows from the knowledge
   *  base; empty when rows are loaded straight from the DB. */
  itemIdByName: Map<string, string>;
  /** slug → item uuid. Only populated when building rows from the knowledge
   *  base; empty when rows are loaded straight from the DB. */
  itemIdBySlug: Map<string, string>;
  /** source code (e.g. "src:martin-2008") → source uuid. Only populated when
   *  building rows from the knowledge base. */
  sourceIdByCode: Map<string, string>;
  stats: {
    items: number;
    links: number;
    evidencedLinks: number;
    sources: number;
    unresolvedEvidenceIds: string[];
  };
}

// Stable namespace for per-item UUIDv5. Never change this value — it's the
// anchor that makes item ids reproducible across reseeds, which is what
// keeps `combine_discoveries` and other FK'd user data intact.
const ITEM_UUID_NAMESPACE = "6f1b2b4e-7a3e-5f8e-9a0b-made0f17e115";

/** UUIDv5 (name-based, SHA-1) per RFC 4122 §4.3. Deterministic from
 *  (namespace, name). */
function uuidv5(namespace: string, name: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(nsBytes)
    .update(name)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Deterministic item id from slug. Exported so admin flows that need to
 *  resolve "what id will this slug have after a reseed" can use it. */
export function itemIdForSlug(slug: string): string {
  return uuidv5(ITEM_UUID_NAMESPACE, slug);
}

/** Build all seed rows from the loaded knowledge base. */
export function toRows(kb: LoadedKnowledgeBase): SeedRows {
  const items: NewItem[] = [];
  const recipes: NewRecipe[] = [];
  const links: NewLink[] = [];

  // Resolve item names/slugs to uuids. Both maps are needed because recipes
  // reference items by name, while canary builders and tests reference them
  // by slug.
  const itemIdByName = new Map<string, string>();
  const itemIdBySlug = new Map<string, string>();

  // Fast lookup from an evidence link id ("child<type<parent") to the concrete
  // link row uuids it should attach to.
  const linkIdsByKey = new Map<string, string[]>();
  const pushLinkKey = (key: string, linkId: string) => {
    const arr = linkIdsByKey.get(key);
    if (arr) arr.push(linkId);
    else linkIdsByKey.set(key, [linkId]);
  };

  // First pass: assign item uuids so recipes/links can reference them.
  // Item ids are derived from slug (UUIDv5) so a reseed produces the same
  // id for the same slug — see note at top of file.
  for (const item of kb.items) {
    const itemId = itemIdForSlug(item.slug);
    itemIdByName.set(item.name, itemId);
    itemIdBySlug.set(item.slug, itemId);
    items.push({
      id: itemId,
      slug: item.slug,
      name: item.name,
      tier: item.tier,
      kind: item.kind,
      firstAppeared: item.firstAppeared,
      firstAppearedYa: item.firstAppearedYears
        ? Math.round(item.firstAppearedYears.ya)
        : null,
      symbol: item.symbol,
      fact: item.fact,
      status: "live",
      isCanary: false,
      isCombineExcluded: item.isCombineExcluded,
      tags: item.tags,
    });
  }

  const resolveName = (name: string): string | null =>
    itemIdByName.get(name) ?? null;

  for (const item of kb.items) {
    const itemId = itemIdByName.get(item.name)!;

    item.recipes.forEach((recipe, idx) => {
      const recipeId = randomUUID();
      recipes.push({
        id: recipeId,
        itemId,
        label: recipe.label,
        position: idx,
      });

      const addRecipeLinks = (type: LinkType, targets: string[]) => {
        targets.forEach((targetName) => {
          const targetId = resolveName(targetName);
          if (!targetId) return; // orphan check runs separately in tests
          const linkId = randomUUID();
          links.push({
            id: linkId,
            recipeId,
            itemId: null,
            type,
            targetItemId: targetId,
            confidence: "established",
            note: null,
            isCanary: false,
          });
          pushLinkKey(`${item.name}<${type}<${targetName}`, linkId);
        });
      };
      addRecipeLinks("f", recipe.f);
      addRecipeLinks("w", recipe.w);
      addRecipeLinks("n", recipe.n);
      addRecipeLinks("e", recipe.e);
    });

    const addItemLinks = (type: LinkType, targets: string[]) => {
      targets.forEach((targetName) => {
        const targetId = resolveName(targetName);
        if (!targetId) return;
        const linkId = randomUUID();
        links.push({
          id: linkId,
          recipeId: null,
          itemId,
          type,
          targetItemId: targetId,
          confidence: "established",
          note: null,
          isCanary: false,
        });
        pushLinkKey(`${item.name}<${type}<${targetName}`, linkId);
      });
    };
    addItemLinks("n", item.itemLinks.n);
    addItemLinks("s", item.itemLinks.s);
  }

  // Sources: assign uuids and index by their citation code.
  const sourceIdByCode = new Map<string, string>();
  const sources: NewSource[] = kb.sources.map((s) => {
    const id = randomUUID();
    sourceIdByCode.set(s.id, id);
    return {
      id,
      code: s.id,
      kind: s.kind,
      title: s.title,
      authors: s.authors,
      year: s.year,
      published: s.published,
      url: s.url,
    };
  });

  // Attach evidence to links.
  const linkEvidence: NewLinkEvidence[] = [];
  const evidenceSources: SeedRows["evidenceSources"] = [];
  const unresolved: string[] = [];
  const evidencedLinkIds = new Set<string>();
  const linkConfidence = new Map<string, string>();

  for (const ev of kb.evidenceLinks) {
    const matchedLinks: string[] = [];
    for (const id of ev.ids) {
      const key = evidenceKeyFromArtifactId(id);
      const linkIds = linkIdsByKey.get(key);
      if (!linkIds || linkIds.length === 0) {
        unresolved.push(id);
        continue;
      }
      for (const lid of linkIds) {
        matchedLinks.push(lid);
        evidencedLinkIds.add(lid);
        linkConfidence.set(lid, ev.confidence);
      }
    }
    if (matchedLinks.length === 0) continue;

    ev.evidence.forEach((entry, i) => {
      for (const linkId of matchedLinks) {
        const evId = randomUUID();
        linkEvidence.push({
          id: evId,
          linkId,
          type: entry.type,
          stance: entry.stance,
          summary: entry.summary,
          position: i,
        });
        entry.sources.forEach((srcCode, k) => {
          const sourceId = sourceIdByCode.get(srcCode);
          if (!sourceId) return;
          evidenceSources.push({
            evidenceId: evId,
            sourceId,
            position: k,
          });
        });
      }
    });
  }

  // Apply denormalised confidence + hasEvidence flag to link rows.
  for (const link of links) {
    const c = linkConfidence.get(link.id!);
    if (c) (link as { confidence: string }).confidence = c;
    (link as { hasEvidence?: boolean }).hasEvidence = evidencedLinkIds.has(
      link.id!,
    );
  }

  const linkNotes = new Map<string, string>();
  for (const ev of kb.evidenceLinks) {
    if (!ev.note) continue;
    for (const id of ev.ids) {
      const key = evidenceKeyFromArtifactId(id);
      const linkIds = linkIdsByKey.get(key);
      if (!linkIds) continue;
      for (const lid of linkIds) linkNotes.set(lid, ev.note);
    }
  }
  for (const link of links) {
    const note = linkNotes.get(link.id!);
    if (note) (link as { note: string | null }).note = note;
  }

  return {
    items,
    recipes,
    links,
    linkEvidence,
    evidenceSources,
    sources,
    itemIdByName,
    itemIdBySlug,
    sourceIdByCode,
    stats: {
      items: items.length,
      links: links.length,
      evidencedLinks: evidencedLinkIds.size,
      sources: sources.length,
      unresolvedEvidenceIds: unresolved,
    },
  };
}

function evidenceKeyFromArtifactId(id: string): string {
  const { childName, type, parentName } = parseLinkId(id);
  return `${childName}<${type}<${parentName}`;
}

/** Count how many distinct `child<type<parent` ids appear across all
 *  evidence records. */
export function countEvidencedLinkIds(
  evidenceLinks: LoadedEvidenceLink[],
): number {
  const ids = new Set<string>();
  for (const l of evidenceLinks) for (const id of l.ids) ids.add(id);
  return ids.size;
}
