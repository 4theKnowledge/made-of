/**
 * Theme closure: start from a seed set, walk playable recipes, add every
 * dependency up to the configured stop rules.
 *
 * Used by /admin/combine/themes to let authors curate a theme by naming
 * a few key items and letting the editor pull in everything the runtime
 * needs to actually build them.
 *
 * Pure function — same inputs produce same outputs. Called from both the
 * server (to compute what to write) and the client (to preview counts
 * before committing).
 */

import type { RecipePartType } from "./parts";

export interface ClosureItem {
  id: string;
  tier: string;
  kind: string;
  tags: string[];
  isCombineExcluded: boolean;
}

export interface ClosureRecipe {
  id: string;
  itemId: string;
  parts: string[];
  /** Per-part link type, aligned with `parts`. Optional — when absent,
   *  `followLinkTypes` becomes a no-op for that recipe (it's always
   *  followed). Server loader includes it; simple tests can omit. */
  partTypes?: RecipePartType[];
}

export interface ClosureConfig {
  /** Members on these tiers are added but their recipes are NOT walked
   *  further. They act as dealt-base ingredients. */
  stopAtTiers?: string[];
  /** Same as stopAtTiers but keyed off item kinds (any match stops). */
  stopAtKinds?: string[];
  /** Same as stopAtTiers but keyed off item tags (any match stops). */
  stopAtTags?: string[];
  /** Restrict closure to recipes using only these link types. Default:
   *  all four combinable types (f, w, n, e). */
  followLinkTypes?: RecipePartType[];
  /** Hard cap on recursion depth from the original seeds. 0 = seeds only. */
  maxDepth?: number;
}

export interface ClosureResult {
  /** Final set of item ids in the theme (seeds + everything reached). */
  members: Set<string>;
  /** Items added by the closure (i.e. members − seeds). */
  added: string[];
  /** Items that joined as members but had their recipes NOT walked
   *  because of a stop rule or depth cap. These are expected to be dealt
   *  as base ingredients in the runtime. */
  stoppedAt: string[];
  /** Items the closure wanted to add but skipped because they're
   *  isCombineExcluded. Surfaced so the UI can flag broken chains. */
  blockedByExcluded: string[];
}

/**
 * Compute the closure of `seeds` under the given config.
 *
 * Algorithm: BFS from seeds. For each item popped, look at every playable
 * recipe it owns. For each recipe, filter parts by `followLinkTypes`
 * (default: all). Each remaining part is a candidate to add.
 *
 *  - If the candidate is `isCombineExcluded`: skip it entirely (recorded
 *    as `blockedByExcluded`), and don't recurse into it.
 *  - Else add it as a member. If it matches a stop rule (tier/tag/depth),
 *    record it in `stoppedAt` and don't enqueue it for further walking.
 *  - Else enqueue it (its own recipes will be walked next round).
 *
 * Deterministic: iteration order is BFS with insertion order from the
 * caller-provided arrays; we sort recipe parts to break ties.
 */
export function computeClosure(args: {
  items: ClosureItem[];
  recipes: ClosureRecipe[];
  seeds: Iterable<string>;
  config: ClosureConfig | null | undefined;
}): ClosureResult {
  const { items, recipes } = args;
  const config = args.config ?? {};
  const seedSet = new Set(args.seeds);

  const itemById = new Map<string, ClosureItem>();
  for (const it of items) itemById.set(it.id, it);

  const recipesByOwner = new Map<string, ClosureRecipe[]>();
  for (const r of recipes) {
    const list = recipesByOwner.get(r.itemId) ?? [];
    list.push(r);
    recipesByOwner.set(r.itemId, list);
  }

  const stopTiers = new Set(config.stopAtTiers ?? []);
  const stopKinds = new Set(config.stopAtKinds ?? []);
  const stopTags = new Set(config.stopAtTags ?? []);
  const followTypes = new Set<RecipePartType>(
    config.followLinkTypes && config.followLinkTypes.length > 0
      ? config.followLinkTypes
      : ["f", "w", "n", "e"],
  );
  const maxDepth = config.maxDepth;

  const members = new Set<string>();
  const stoppedAt = new Set<string>();
  const blockedByExcluded = new Set<string>();
  const depth = new Map<string, number>();

  // Seed the frontier. Depth 0 seeds are always walked once (so their
  // direct recipes get followed) unless they themselves hit a stop rule.
  const queue: string[] = [];
  for (const id of seedSet) {
    const it = itemById.get(id);
    if (!it) continue;
    if (it.isCombineExcluded) {
      blockedByExcluded.add(id);
      continue;
    }
    members.add(id);
    depth.set(id, 0);
    queue.push(id);
  }

  while (queue.length) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    const item = itemById.get(id);
    if (!item) continue;

    // Stop rules: tier/tag/depth. Stopped items stay as members; their
    // recipes just aren't walked further.
    const tierStops = stopTiers.has(item.tier);
    const kindStops = stopKinds.has(item.kind);
    const tagStops = item.tags.some((t) => stopTags.has(t));
    const depthStops = typeof maxDepth === "number" && d >= maxDepth;
    // Seeds still get walked at depth 0 even if tagged as stops — the
    // author asked for them explicitly. A stop rule only prevents
    // recursion *past* an item added by closure, not past an initial seed.
    const isSeed = seedSet.has(id);
    if (!isSeed && (tierStops || kindStops || tagStops)) {
      stoppedAt.add(id);
      continue;
    }
    if (depthStops) {
      stoppedAt.add(id);
      continue;
    }

    const rs = recipesByOwner.get(id);
    if (!rs || rs.length === 0) continue;

    for (const r of rs) {
      const types = r.partTypes;
      for (let i = 0; i < r.parts.length; i++) {
        const partId = r.parts[i];
        if (types && !followTypes.has(types[i] as RecipePartType)) continue;
        if (partId === id) continue;

        const part = itemById.get(partId);
        if (!part) continue;
        if (part.isCombineExcluded) {
          blockedByExcluded.add(partId);
          continue;
        }

        if (members.has(partId)) continue;
        members.add(partId);
        depth.set(partId, d + 1);
        queue.push(partId);
      }
    }
  }

  const added: string[] = [];
  for (const id of members) if (!seedSet.has(id)) added.push(id);
  added.sort();

  return {
    members,
    added,
    stoppedAt: [...stoppedAt].sort(),
    blockedByExcluded: [...blockedByExcluded].sort(),
  };
}

/** Convenience: true if the config would actually do anything. A null or
 *  all-empty config means "no auto-chain" and callers should short-circuit. */
export function isClosureEnabled(c: ClosureConfig | null | undefined): boolean {
  if (!c) return false;
  // Any non-empty field = enabled. Empty object = enabled with defaults
  // (chain unlimited, all link types). That's a valid "yes, chain
  // everything" choice.
  return true;
}
