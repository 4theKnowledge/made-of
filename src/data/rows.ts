/**
 * Convert a `LoadedKnowledgeBase` into the rows that will be inserted into
 * Postgres. Ids are deterministic so re-running the seed gives the same row
 * ids, which makes diffs and migrations easy.
 */

import type {
  LinkType,
  NewItem,
  NewLink,
  NewLinkEvidence,
  NewRecipe,
  NewSource,
} from "../db/schema";
import { parseLinkId, slug } from "./load";
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
  stats: {
    items: number;
    links: number;
    evidencedLinks: number;
    sources: number;
    unresolvedEvidenceIds: string[];
  };
}

/** Build all seed rows from the loaded knowledge base. */
export function toRows(kb: LoadedKnowledgeBase): SeedRows {
  const items: NewItem[] = [];
  const recipes: NewRecipe[] = [];
  const links: NewLink[] = [];

  // Fast lookup from an evidence link id ("child<type<parent") to the concrete
  // link row ids it should attach to.
  const linkIdsByKey = new Map<string, string[]>();
  const pushLinkKey = (key: string, linkId: string) => {
    const arr = linkIdsByKey.get(key);
    if (arr) arr.push(linkId);
    else linkIdsByKey.set(key, [linkId]);
  };

  for (const item of kb.items) {
    const itemId = item.slug;
    items.push({
      id: itemId,
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
    });

    item.recipes.forEach((recipe, idx) => {
      const recipeId = `${itemId}:r${idx}`;
      recipes.push({
        id: recipeId,
        itemId,
        label: recipe.label,
        position: idx,
      });

      const addRecipeLinks = (type: LinkType, targets: string[]) => {
        targets.forEach((targetName, j) => {
          const targetId = slug(targetName);
          const linkId = `${recipeId}:${type}:${j}:${targetId}`;
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
      targets.forEach((targetName, j) => {
        const targetId = slug(targetName);
        const linkId = `${itemId}:item:${type}:${j}:${targetId}`;
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

  // Attach evidence to links.
  const linkEvidence: NewLinkEvidence[] = [];
  const evidenceSources: SeedRows["evidenceSources"] = [];
  const unresolved: string[] = [];
  const evidencedLinkIds = new Set<string>();
  const linkConfidence = new Map<string, string>();

  let evidenceCounter = 0;
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
        const evId = `ev:${linkId}:${i}:${++evidenceCounter}`;
        linkEvidence.push({
          id: evId,
          linkId,
          type: entry.type,
          stance: entry.stance,
          summary: entry.summary,
          position: i,
        });
        entry.sources.forEach((srcId, k) => {
          evidenceSources.push({
            evidenceId: evId,
            sourceId: srcId,
            position: k,
          });
        });
      }
    });
  }

  // Apply denormalised confidence + hasEvidence flag to link rows.
  for (const link of links) {
    const c = linkConfidence.get(link.id);
    if (c) (link as { confidence: string }).confidence = c;
    (link as { hasEvidence?: boolean }).hasEvidence = evidencedLinkIds.has(
      link.id,
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
    const note = linkNotes.get(link.id);
    if (note) (link as { note: string | null }).note = note;
  }

  const sources: NewSource[] = kb.sources.map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    authors: s.authors,
    year: s.year,
    published: s.published,
    url: s.url,
  }));

  return {
    items,
    recipes,
    links,
    linkEvidence,
    evidenceSources,
    sources,
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
