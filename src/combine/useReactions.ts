"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/auth-client";

export type ReactionTarget = "recipe" | "item";
export type ReactionValue = -1 | 0 | 1;

export interface ReactionState {
  /** Current user's vote. `null` if signed-out or never voted. */
  mine: -1 | 1 | null;
  up: number;
  down: number;
}

export interface UseReactionsResult {
  recipeReactions: ReadonlyMap<string, ReactionState>;
  itemReactions: ReadonlyMap<string, ReactionState>;
  /** Signed-in flag so the UI can degrade to "sign in to react" prompts
   *  rather than silently no-opping. */
  authed: boolean;
  /** Optimistically set a vote. `value === 0` clears the vote. A `reason`
   *  (optional, free-text) travels with the POST. */
  vote: (
    target: ReactionTarget,
    id: string,
    value: ReactionValue,
    reason?: string,
  ) => void;
}

/**
 * Batches reaction lookups for a set of recipe and item ids. Signed-out
 * players get empty maps and a no-op `vote`.
 *
 * The id lists are stabilised internally (sort + dedupe) so the caller can
 * pass the same conceptual set without worrying about array identity.
 */
export function useReactions(opts: {
  recipeIds?: ReadonlyArray<string>;
  itemIds?: ReadonlyArray<string>;
}): UseReactionsResult {
  const { data: session, isPending } = useSession();
  const authed = Boolean(session?.user);

  // Stabilise the id lists. React re-renders often pass new array literals
  // even when the content is the same; sorted+joined keys catch that.
  const recipeIds = useMemo(
    () => dedupeSorted(opts.recipeIds),
    [keyOf(opts.recipeIds)],
  );
  const itemIds = useMemo(
    () => dedupeSorted(opts.itemIds),
    [keyOf(opts.itemIds)],
  );

  const [recipeReactions, setRecipeReactions] = useState<
    Map<string, ReactionState>
  >(() => new Map());
  const [itemReactions, setItemReactions] = useState<
    Map<string, ReactionState>
  >(() => new Map());
  const didHydrate = useRef<string>("");

  useEffect(() => {
    if (isPending) return;
    const key = `${authed ? "a" : "x"}:${recipeIds.join(",")}:${itemIds.join(",")}`;
    if (didHydrate.current === key) return;
    didHydrate.current = key;

    if (recipeIds.length === 0 && itemIds.length === 0) {
      setRecipeReactions(new Map());
      setItemReactions(new Map());
      return;
    }

    let cancelled = false;
    (async () => {
      const qp = new URLSearchParams();
      if (recipeIds.length) qp.set("recipe", recipeIds.join(","));
      if (itemIds.length) qp.set("item", itemIds.join(","));
      try {
        const res = await fetch(`/api/combine/reactions?${qp.toString()}`, {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          recipe?: Record<string, ReactionState>;
          item?: Record<string, ReactionState>;
        };
        if (cancelled) return;
        setRecipeReactions(new Map(Object.entries(json.recipe ?? {})));
        setItemReactions(new Map(Object.entries(json.item ?? {})));
      } catch {
        // Keep whatever's in memory — the UI stays responsive, votes still POST.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authed, isPending, recipeIds, itemIds]);

  const vote = useCallback(
    (
      target: ReactionTarget,
      id: string,
      value: ReactionValue,
      reason?: string,
    ) => {
      // Optimistic local update. We adjust `up`/`down` counts so the eventual
      // GET re-fetch doesn't make numbers jitter; `mine` carries the player's
      // own vote.
      const setter = target === "recipe" ? setRecipeReactions : setItemReactions;
      setter((prev) => {
        const next = new Map(prev);
        const cur = next.get(id) ?? { mine: null, up: 0, down: 0 };
        let { up, down } = cur;
        if (cur.mine === 1) up = Math.max(0, up - 1);
        if (cur.mine === -1) down = Math.max(0, down - 1);
        let mine: -1 | 1 | null = null;
        if (value === 1) {
          up += 1;
          mine = 1;
        } else if (value === -1) {
          down += 1;
          mine = -1;
        }
        next.set(id, { mine, up, down });
        return next;
      });
      if (!authed) return;
      void fetch("/api/combine/reactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetKind: target,
          targetId: id,
          value,
          ...(reason ? { reason } : {}),
        }),
      }).catch(() => {
        // Local state stays as-is; next GET will reconcile on a reload.
      });
    },
    [authed],
  );

  return { recipeReactions, itemReactions, authed, vote };
}

function dedupeSorted(ids: ReadonlyArray<string> | undefined): string[] {
  if (!ids || ids.length === 0) return [];
  return [...new Set(ids)].sort();
}

function keyOf(ids: ReadonlyArray<string> | undefined): string {
  if (!ids || ids.length === 0) return "";
  return [...new Set(ids)].sort().join(",");
}
