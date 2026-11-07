/**
 * Shared recipe-parts rules for Combine.
 *
 * Both the runtime bundle builder (src/combine/data.ts) and the admin theme
 * validator (src/app/admin/combine/themes/validator.ts) need to agree on
 * what counts as a Combine recipe and which parts it consumes. This module
 * centralises those rules so the two can't drift.
 *
 * Rules:
 *  - Combinable link types: `f`, `w`, `n`, `e` (the four recipe-scoped
 *    types). Players place all of them together on the board.
 *  - A recipe's output cannot be one of its own parts. Self-refs are
 *    dropped from the parts list (`hadSelfRef` is set for callers that
 *    want to reject the collapsed recipe).
 *  - A playable recipe has 1–7 unique parts, none equal to the output,
 *    and is not a self-ref that collapsed to <2 parts.
 */

export type RecipePartType = "f" | "w" | "n" | "e";

const COMBINABLE: ReadonlySet<string> = new Set(["f", "w", "n", "e"]);

/** True if a link type can appear as a Combine ingredient. */
export function isCombinableLinkType(t: string): t is RecipePartType {
  return COMBINABLE.has(t);
}

/** Dedup + drop self-ref from a raw list of recipe-scoped edges. */
export function collectRecipeParts(
  edges: Iterable<{ type: string; targetId: string }>,
  outputId: string,
): { all: string[]; hadSelfRef: boolean } {
  const set = new Set<string>();
  let hadSelfRef = false;
  for (const e of edges) {
    if (!isCombinableLinkType(e.type)) continue;
    if (e.targetId === outputId) {
      hadSelfRef = true;
      continue;
    }
    set.add(e.targetId);
  }
  return { all: [...set], hadSelfRef };
}

/** Would Combine's bundle builder keep this recipe?
 *
 *  - 1 part is allowed (surfaced as a "promote" action).
 *  - 8+ parts is rejected (too wide for the board).
 *  - A recipe that only survived by dropping a self-ref AND ends up with
 *    <2 parts is rejected — collapsed 1-input ("recycled paper from water")
 *    reads as nonsense.
 */
export function isPlayableRecipe(input: { all: string[]; hadSelfRef: boolean }): boolean {
  const n = input.all.length;
  if (n < 1 || n > 7) return false;
  if (input.hadSelfRef && n < 2) return false;
  return true;
}
