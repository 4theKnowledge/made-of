"use client";

import Link from "next/link";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Confidence, ItemKind, ItemStatus, LinkType, Tier } from "@/db/schema";
import { REL } from "@/lib/rel";
import { TIER, TIER_ORDER } from "@/lib/taxonomy";
import { api, type ItemRow, type LinkRow, type RecipeRow } from "./treeApi";
import { useAdminToast } from "../_toast";
import { useConfirm } from "@/components/common/useConfirm";

export interface TreeData {
  items: ItemRow[];
  recipes: RecipeRow[];
  links: LinkRow[];
  kinds: { code: string; label: string }[];
  combineThemes: { code: string; label: string }[];
  itemThemes: { itemId: string; themeCode: string }[];
}

const STORAGE_KEY = "admin:tree:expanded:v2";
const INDENT = 20;

function tierBg(t: Tier) {
  return `var(--t${t})`;
}

function confidenceDot(c: Confidence) {
  switch (c) {
    case "established":
      return "#2ea043";
    case "strong":
      return "#79c0ff";
    case "debated":
      return "#f0b429";
    case "hypothesis":
      return "#f85149";
  }
}

const CONFIDENCE_DESC: Record<Confidence, string> = {
  established: "Established — settled science",
  strong: "Strong — well supported",
  debated: "Debated — competing views",
  hypothesis: "Hypothesis — speculative",
};

const LINK_TYPES: LinkType[] = ["f", "w", "n", "s", "e"];
const CONFIDENCES: Confidence[] = ["established", "strong", "debated", "hypothesis"];
const STATUSES: ItemStatus[] = ["draft", "review", "live"];

function statusColour(s: ItemStatus) {
  return s === "live" ? "var(--good, #2a7a2a)" : s === "review" ? "var(--warn, #a66400)" : "var(--muted)";
}

function StatusPill({ status }: { status: ItemStatus }) {
  const colour = statusColour(status);
  return (
    <span
      style={{
        fontFamily: "var(--mono, monospace)",
        fontSize: 10,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: colour,
        border: `1px solid ${colour}`,
        padding: "0 5px",
        borderRadius: 3,
        lineHeight: "14px",
      }}
    >
      {status}
    </span>
  );
}

/* ========================================================================
 * Derived views over TreeData — recomputed on every state change. Cheap at
 * this scale (hundreds of items/links).
 * ====================================================================== */

function deriveViews(data: TreeData) {
  const itemById = new Map<string, ItemRow>();
  for (const it of data.items) itemById.set(it.id, it);

  const recipeById = new Map<string, RecipeRow>();
  const recipesByItem = new Map<string, RecipeRow[]>();
  for (const r of data.recipes) {
    recipeById.set(r.id, r);
    const arr = recipesByItem.get(r.itemId) ?? [];
    arr.push(r);
    recipesByItem.set(r.itemId, arr);
  }
  for (const arr of recipesByItem.values()) arr.sort((a, b) => a.position - b.position);

  // Resolved source for each link.
  const linkSource = new Map<string, string>();
  for (const l of data.links) {
    const src = l.itemId ?? (l.recipeId ? recipeById.get(l.recipeId)?.itemId ?? null : null);
    if (src) linkSource.set(l.linkId, src);
  }

  // Links grouped by owning item and whether they're recipe- or item-scoped.
  const linksByItem = new Map<
    string,
    { recipe: Map<string, LinkRow[]>; itemLevel: LinkRow[]; incoming: LinkRow[] }
  >();
  function ensureBucket(itemId: string) {
    let b = linksByItem.get(itemId);
    if (!b) {
      b = { recipe: new Map(), itemLevel: [], incoming: [] };
      linksByItem.set(itemId, b);
    }
    return b;
  }
  for (const l of data.links) {
    const src = linkSource.get(l.linkId);
    if (!src) continue;
    const sb = ensureBucket(src);
    if (l.recipeId) {
      const arr = sb.recipe.get(l.recipeId) ?? [];
      arr.push(l);
      sb.recipe.set(l.recipeId, arr);
    } else {
      sb.itemLevel.push(l);
    }
    ensureBucket(l.targetItemId).incoming.push(l);
  }

  // Parent sets per item (via resolved link source) and parent count.
  const parentsByItem = new Map<string, Set<string>>();
  const parentCountByItem = new Map<string, number>();
  for (const l of data.links) {
    const src = linkSource.get(l.linkId);
    if (src) {
      const set = parentsByItem.get(l.targetItemId) ?? new Set<string>();
      set.add(src);
      parentsByItem.set(l.targetItemId, set);
    }
    parentCountByItem.set(l.targetItemId, (parentCountByItem.get(l.targetItemId) ?? 0) + 1);
  }

  // Roots: items with no incoming forward links. (We treat *all* incoming as
  // disqualifying — same as before.)
  const roots = data.items
    .filter((it) => !parentCountByItem.has(it.id))
    .map((it) => it.id);

  return {
    itemById,
    recipeById,
    recipesByItem,
    linksByItem,
    parentCountByItem,
    parentsByItem,
    roots,
    linkSource,
  };
}

type Views = ReturnType<typeof deriveViews>;

/* ========================================================================
 * TreeContext — stable per-render state shared by every Row/RecipeGroup.
 *
 * We pull everything that isn't identity-specific out of props so Row can be
 * React.memo'd and a single edit doesn't cascade through the whole tree.
 * The context value itself is memoised, so subscribers only re-render when a
 * dependency they actually read changes.
 * ====================================================================== */

interface TreeContextValue {
  data: TreeData;
  views: Views;
  expanded: Set<string>;
  matches: Set<string> | null;
  visibleIds: Set<string> | null;
  selectedSet: Set<string>;
  toggle: (path: string) => void;
  forceExpand: (path: string) => void;
  onEditItem: (id: string) => void;
  onToggleSelected: (itemId: string, shiftKey: boolean) => void;
  onCreateLink: (input: {
    type: LinkType;
    targetItemId: string;
    recipeId: string | null;
    itemId: string | null;
    confidence: Confidence;
  }) => Promise<void>;
  onPatchLink: (id: string, patch: { confidence?: Confidence }) => Promise<void>;
  onDeleteLink: (id: string) => Promise<void>;
  onCreateRecipe: (itemId: string, label: string | null) => Promise<void>;
  onDeleteRecipe: (id: string) => Promise<void>;
}

const TreeContext = createContext<TreeContextValue | null>(null);

function useTree(): TreeContextValue {
  const v = useContext(TreeContext);
  if (!v) throw new Error("TreeContext missing");
  return v;
}

/* ========================================================================
 * TreeList — main component.
 * ====================================================================== */

export function TreeList({ initialData }: { initialData: TreeData }) {
  const [data, setData] = useState<TreeData>(initialData);
  const views = useMemo(() => deriveViews(data), [data]);


  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  // Debounced copy used for actual matching. Without this, every
  // keystroke on a dense KB triggers a full tree re-render cascade
  // (match set → ancestor set → virtualiser remeasure → row remount),
  // which can crash the tab mid-type even under the cap.
  const [queryApplied, setQueryApplied] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setQueryApplied(query), 180);
    return () => clearTimeout(h);
  }, [query]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setExpanded(new Set(JSON.parse(raw) as string[]));
    } catch {
      // ignore
    }
  }, []);

  const persistExpanded = useCallback((s: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(s)));
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        persistExpanded(next);
        return next;
      });
    },
    [persistExpanded],
  );

  const forceExpand = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        if (prev.has(path)) return prev;
        const next = new Set(prev);
        next.add(path);
        persistExpanded(next);
        return next;
      });
    },
    [persistExpanded],
  );

  // Toasts come from the admin-wide provider so every admin surface shares
  // the same widget (and 422 audit messages render identically everywhere).
  const { push: toast } = useAdminToast();

  const { confirm, dialog: confirmDialog } = useConfirm();

  // Mutation helper: optimistic update + rollback on error.
  const mutate = useCallback(
    async <T,>(
      optimistic: (d: TreeData) => TreeData,
      request: () => Promise<T>,
      onSuccess?: (result: T, applied: TreeData) => TreeData | void,
      errorPrefix = "Mutation failed",
    ) => {
      let previous: TreeData | null = null;
      setData((prev) => {
        previous = prev;
        return optimistic(prev);
      });
      try {
        const result = await request();
        if (onSuccess) {
          setData((prev) => {
            const next = onSuccess(result, prev);
            return next ?? prev;
          });
        }
        return result;
      } catch (e) {
        if (previous) setData(previous);
        const msg = e instanceof Error ? e.message : String(e);
        toast(`${errorPrefix}: ${msg}`);
        throw e;
      }
    },
    [toast],
  );

  /* -- Mutations ------------------------------------------------------- */

  const createLink = useCallback(
    async (input: {
      type: LinkType;
      targetItemId: string;
      recipeId: string | null;
      itemId: string | null;
      confidence: Confidence;
    }) => {
      const tempId = `tmp:${Math.random().toString(36).slice(2)}`;
      await mutate(
        (d) => ({
          ...d,
          links: [
            ...d.links,
            {
              linkId: tempId,
              type: input.type,
              targetItemId: input.targetItemId,
              recipeId: input.recipeId,
              itemId: input.itemId,
              confidence: input.confidence,
            },
          ],
        }),
        () =>
          api.createLink({
            type: input.type,
            targetItemId: input.targetItemId,
            recipeId: input.recipeId ?? undefined,
            itemId: input.itemId ?? undefined,
            confidence: input.confidence,
          }),
        (result, applied) => ({
          ...applied,
          links: applied.links.map((l) =>
            l.linkId === tempId
              ? {
                  linkId: result.link.id,
                  type: result.link.type,
                  confidence: result.link.confidence,
                  recipeId: result.link.recipeId,
                  itemId: result.link.itemId,
                  targetItemId: result.link.targetItemId,
                }
              : l,
          ),
        }),
        "Create link failed",
      );
    },
    [mutate],
  );

  const patchLink = useCallback(
    async (id: string, patch: { confidence?: Confidence; note?: string | null; isCanary?: boolean }) => {
      await mutate(
        (d) => ({
          ...d,
          links: d.links.map((l) =>
            l.linkId === id && patch.confidence ? { ...l, confidence: patch.confidence } : l,
          ),
        }),
        () => api.patchLink(id, patch),
        undefined,
        "Update link failed",
      );
    },
    [mutate],
  );

  const deleteLink = useCallback(
    async (id: string) => {
      if (
        !(await confirm({
          title: "Delete this link?",
          confirmLabel: "Delete",
          destructive: true,
        }))
      )
        return;
      await mutate(
        (d) => ({ ...d, links: d.links.filter((l) => l.linkId !== id) }),
        () => api.deleteLink(id),
        undefined,
        "Delete link failed",
      );
    },
    [mutate, confirm],
  );

  const createRecipe = useCallback(
    async (itemId: string, label: string | null) => {
      const tempId = `tmp:${Math.random().toString(36).slice(2)}`;
      const existing = views.recipesByItem.get(itemId) ?? [];
      const position = existing.length ? Math.max(...existing.map((r) => r.position)) + 1 : 0;
      await mutate(
        (d) => ({
          ...d,
          recipes: [...d.recipes, { id: tempId, itemId, label, position }],
        }),
        () => api.createRecipe({ itemId, label, position }),
        (result, applied) => ({
          ...applied,
          recipes: applied.recipes.map((r) => (r.id === tempId ? result.recipe : r)),
        }),
        "Create recipe failed",
      );
    },
    [mutate, views],
  );

  const deleteRecipe = useCallback(
    async (id: string) => {
      const recipe = data.recipes.find((r) => r.id === id);
      const label = recipe
        ? `recipe #${recipe.position}${recipe.label ? ` (${recipe.label})` : ""}`
        : "this recipe";
      if (
        !(await confirm({
          title: `Delete ${label}?`,
          body: "All its links will be deleted too.",
          confirmLabel: "Delete recipe",
          destructive: true,
        }))
      )
        return;
      await mutate(
        (d) => ({
          ...d,
          recipes: d.recipes.filter((r) => r.id !== id),
          // Cascade: cull links on that recipe locally; server does it via FK.
          links: d.links.filter((l) => l.recipeId !== id),
        }),
        () => api.deleteRecipe(id),
        undefined,
        "Delete recipe failed",
      );
    },
    [mutate, confirm, data.recipes],
  );

  const createItem = useCallback(
    async (input: { name: string; tier: Tier; kind: ItemKind }) => {
      const tempId = `tmp:${Math.random().toString(36).slice(2)}`;
      const optimisticRow: ItemRow = {
        id: tempId,
        ...input,
        status: "draft",
        firstAppeared: null,
        symbol: null,
        fact: "",
        tags: [],
        isCanary: false,
        isCombineExcluded: false,
        updatedAt: new Date().toISOString(),
      };
      await mutate(
        (d) => ({ ...d, items: [...d.items, optimisticRow] }),
        () => api.createItem(input),
        (result, applied) => ({
          ...applied,
          items: applied.items.map((it) =>
            it.id === tempId ? { ...optimisticRow, id: result.id } : it,
          ),
        }),
        "Create item failed",
      );
    },
    [mutate],
  );

  const patchItem = useCallback(
    async (
      id: string,
      input: Partial<Pick<ItemRow, "name" | "tier" | "kind" | "firstAppeared" | "symbol" | "fact" | "tags" | "status" | "isCanary" | "isCombineExcluded">>,
    ) => {
      await mutate(
        (d) => ({
          ...d,
          items: d.items.map((it) =>
            it.id === id ? { ...it, ...input, updatedAt: new Date().toISOString() } : it,
          ),
        }),
        () => api.patchItem(id, input),
        (result, applied) => ({
          ...applied,
          items: applied.items.map((it) =>
            it.id === id ? { ...it, ...result.item } : it,
          ),
        }),
        "Update item failed",
      );
    },
    [mutate],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      await mutate(
        (d) => ({
          ...d,
          items: d.items.filter((it) => it.id !== id),
          // Also drop any orphaned links referencing this item locally; the
          // server rejects with has_incoming_links when there are inbound
          // links, so this only runs when the server actually succeeds.
          links: d.links.filter((l) => l.itemId !== id && l.targetItemId !== id),
          recipes: d.recipes.filter((r) => r.itemId !== id),
        }),
        () => api.deleteItem(id),
        undefined,
        "Delete item failed",
      );
    },
    [mutate],
  );

  const publishItem = useCallback(
    async (id: string) => {
      await mutate(
        (d) => ({
          ...d,
          items: d.items.map((it) => (it.id === id ? { ...it, status: "live" } : it)),
        }),
        () => api.publishItem(id),
        undefined,
        "Publish failed",
      );
    },
    [mutate],
  );

  const unpublishItem = useCallback(
    async (id: string) => {
      await mutate(
        (d) => ({
          ...d,
          items: d.items.map((it) => (it.id === id ? { ...it, status: "draft" } : it)),
        }),
        () => api.unpublishItem(id),
        undefined,
        "Unpublish failed",
      );
    },
    [mutate],
  );

  const setItemThemes = useCallback(
    async (itemId: string, themes: string[]) => {
      await mutate(
        (d) => ({
          ...d,
          itemThemes: [
            ...d.itemThemes.filter((r) => r.itemId !== itemId),
            ...themes.map((themeCode) => ({ itemId, themeCode })),
          ],
        }),
        () => api.setItemThemes(itemId, themes),
        undefined,
        "Update themes failed",
      );
    },
    [mutate],
  );

  const bulkPatch = useCallback(
    async (ids: string[], patch: Parameters<typeof api.bulkPatchItems>[0]["patch"]) => {
      const now = new Date().toISOString();
      await mutate(
        (d) => {
          let next = d;
          const setIds = new Set(ids);
          // Core fields (status, isCanary, isCombineExcluded).
          if (
            patch.status ||
            typeof patch.isCanary === "boolean" ||
            typeof patch.isCombineExcluded === "boolean"
          ) {
            next = {
              ...next,
              items: next.items.map((it) =>
                setIds.has(it.id)
                  ? {
                      ...it,
                      ...(patch.status ? { status: patch.status } : {}),
                      ...(typeof patch.isCanary === "boolean" ? { isCanary: patch.isCanary } : {}),
                      ...(typeof patch.isCombineExcluded === "boolean"
                        ? { isCombineExcluded: patch.isCombineExcluded }
                        : {}),
                      updatedAt: now,
                    }
                  : it,
              ),
            };
          }
          // Tags.
          if (patch.addTags?.length || patch.removeTags?.length) {
            next = {
              ...next,
              items: next.items.map((it) => {
                if (!setIds.has(it.id)) return it;
                const tagSet = new Set(it.tags);
                for (const t of patch.addTags ?? []) tagSet.add(t);
                for (const t of patch.removeTags ?? []) tagSet.delete(t);
                return { ...it, tags: Array.from(tagSet), updatedAt: now };
              }),
            };
          }
          // Themes.
          if (patch.setThemes?.add?.length || patch.setThemes?.remove?.length) {
            const addThemes = patch.setThemes.add ?? [];
            const removeThemes = new Set(patch.setThemes.remove ?? []);
            // Drop any (itemId, themeCode) we're about to re-insert or remove.
            const filtered = next.itemThemes.filter((r) => {
              if (!setIds.has(r.itemId)) return true;
              if (removeThemes.has(r.themeCode)) return false;
              if (addThemes.includes(r.themeCode)) return false;
              return true;
            });
            const toAdd = ids.flatMap((itemId) =>
              addThemes.map((themeCode) => ({ itemId, themeCode })),
            );
            next = { ...next, itemThemes: [...filtered, ...toAdd] };
          }
          return next;
        },
        () => api.bulkPatchItems({ itemIds: ids, patch }),
        undefined,
        "Bulk update failed",
      );
    },
    [mutate],
  );

  const bulkDelete = useCallback(
    async (ids: string[]) => {
      const setIds = new Set(ids);
      await mutate(
        (d) => ({
          ...d,
          items: d.items.filter((it) => !setIds.has(it.id)),
          links: d.links.filter((l) => !setIds.has(l.targetItemId) && !(l.itemId && setIds.has(l.itemId))),
          recipes: d.recipes.filter((r) => !setIds.has(r.itemId)),
          itemThemes: d.itemThemes.filter((r) => !setIds.has(r.itemId)),
        }),
        async () => {
          const result = await api.bulkDeleteItems(ids);
          if (result.blocked.length) {
            // Server refused some; surface via throw so toast fires AND the
            // optimistic update rolls back.
            throw new Error(
              `${result.deleted} deleted · ${result.blocked.length} blocked by incoming links`,
            );
          }
          return result;
        },
        undefined,
        "Bulk delete failed",
      );
    },
    [mutate],
  );

  /* -- Filter + view --------------------------------------------------- */

  const [statusFilter, setStatusFilter] = useState<ItemStatus | "all">("all");
  const [tierFilter, setTierFilter] = useState<Tier | "all">("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [view, setView] = useState<"tree" | "flat">("tree");

  // Bulk selection. Keyed by item id, not path — a single item can appear in
  // multiple lineages in the tree, but selecting it is "pick this item" so
  // we track by id. Lineage duplicates reflect the selection together.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastSelectedId = useRef<string | null>(null);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    lastSelectedId.current = null;
  }, []);

  /**
   * Called when a row's checkbox is toggled. Supports shift-click for a
   * range select over the current alpha-sorted visible item list — gives
   * a predictable range even for tangled-tree views.
   */
  const onRowSelectionToggle = useCallback(
    (itemId: string, shiftKey: boolean, visibleOrderedIds: string[]) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (shiftKey && lastSelectedId.current) {
          const from = visibleOrderedIds.indexOf(lastSelectedId.current);
          const to = visibleOrderedIds.indexOf(itemId);
          if (from >= 0 && to >= 0) {
            const [lo, hi] = from < to ? [from, to] : [to, from];
            // Range-select copies the current state of the anchor onto
            // every item in [lo, hi]. If the anchor was in the set, we
            // add them all; otherwise we remove them all.
            const shouldAdd = prev.has(lastSelectedId.current);
            for (let i = lo; i <= hi; i++) {
              if (shouldAdd) next.add(visibleOrderedIds[i]);
              else next.delete(visibleOrderedIds[i]);
            }
            return next;
          }
        }
        if (next.has(itemId)) next.delete(itemId);
        else next.add(itemId);
        lastSelectedId.current = itemId;
        return next;
      });
    },
    [],
  );

  const availableTags = useMemo(() => {
    const s = new Set<string>();
    for (const it of data.items) for (const t of it.tags) if (t) s.add(t);
    return Array.from(s).sort();
  }, [data.items]);

  // If the selected tag disappears (last item carrying it was deleted or
  // retagged), fall back to "all" so the filter doesn't silently hide
  // everything.
  useEffect(() => {
    if (tagFilter !== "all" && !availableTags.includes(tagFilter)) {
      setTagFilter("all");
    }
  }, [availableTags, tagFilter]);

  const q = queryApplied.trim().toLowerCase();
  const matches = useMemo(() => {
    const isFiltered =
      q !== "" || statusFilter !== "all" || tierFilter !== "all" || tagFilter !== "all";
    if (!isFiltered) return null;
    const s = new Set<string>();
    for (const it of data.items) {
      if (q && !it.name.toLowerCase().includes(q)) continue;
      if (statusFilter !== "all" && it.status !== statusFilter) continue;
      if (tierFilter !== "all" && it.tier !== tierFilter) continue;
      if (tagFilter !== "all" && !it.tags.includes(tagFilter)) continue;
      s.add(it.id);
    }
    return s;
  }, [q, statusFilter, tierFilter, tagFilter, data.items]);

  // Tree visibility: matches + all ancestors leading to them (so lineage
  // context is preserved). Null when no filter is active.
  const visibleIds = useMemo(() => {
    if (!matches) return null;
    const visible = new Set<string>(matches);
    const stack = Array.from(matches);
    while (stack.length) {
      const cur = stack.pop()!;
      const parents = views.parentsByItem.get(cur);
      if (!parents) continue;
      for (const p of parents) {
        if (!visible.has(p)) {
          visible.add(p);
          stack.push(p);
        }
      }
    }
    return visible;
  }, [matches, views]);

  // Hard cap on tree render under a filter. `visibleIds` counts unique items,
  // but Row recurses the DAG and can mount a single item many times (once per
  // ancestor path). Searching for a common substring in a dense KB can
  // explode into tens of thousands of row mounts and crash the tab. Above
  // this cap we refuse to render the tree and point the user at flat view.
  // Kept low because DAG multiplicity can mount a single visibleIds entry
  // many times; 150 unique items with 10× multiplicity is already 1500 rows.
  const TREE_RENDER_CAP = 150;
  const treeOverCap = !!visibleIds && visibleIds.size > TREE_RENDER_CAP;

  // Under a filter, only mount roots that actually contain a match. Without
  // this, VirtualRootList still iterates every root in `views.roots` (each
  // Row early-returns null if not in visibleIds, but the virtualiser still
  // mounts them and measures their height).
  const rootsToRender = useMemo(() => {
    if (!visibleIds) return views.roots;
    return views.roots.filter((r) => visibleIds.has(r));
  }, [views.roots, visibleIds]);

  /**
   * Alpha-sorted list of item ids currently targetable by bulk actions.
   * Under a filter: matches only (not ancestors shown for context). Without
   * a filter: all items. Shift-click range selection operates over this
   * ordering so it stays predictable across tree/flat views.
   */
  const visibleOrderedIds = useMemo(() => {
    const pool = matches
      ? data.items.filter((it) => matches.has(it.id))
      : data.items;
    return pool
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((it) => it.id);
  }, [matches, data.items]);

  const expandAll = useCallback(async () => {
    // Hard caps keep this safe as the KB grows: without them, "expand all" on
    // a dense graph can mount tens of thousands of rows and lock the tab.
    const MAX_DEPTH = 8;
    const MAX_EXPANSIONS = 2000;
    const all = new Set<string>();
    let aborted = false;
    const walk = (itemId: string, path: string, depth: number, seen: Set<string>) => {
      if (aborted || depth >= MAX_DEPTH || seen.has(itemId)) return;
      const bucket = views.linksByItem.get(itemId);
      const kids = bucket ? [...bucket.itemLevel, ...Array.from(bucket.recipe.values()).flat()] : [];
      if (!kids.length) return;
      all.add(path);
      if (all.size >= MAX_EXPANSIONS) {
        aborted = true;
        return;
      }
      const next = new Set(seen);
      next.add(itemId);
      for (const k of kids) walk(k.targetItemId, `${path}/${k.targetItemId}`, depth + 1, next);
    };
    for (const r of views.roots) {
      if (aborted) break;
      walk(r, r, 0, new Set());
    }
    if (aborted) {
      const proceed = await confirm({
        title: `Expand ${all.size} branches?`,
        body: `Expanding would show ${MAX_EXPANSIONS}+ branches. Narrow with search/filters first for better results.`,
        confirmLabel: "Expand",
      });
      if (!proceed) return;
    }
    setExpanded(all);
    persistExpanded(all);
  }, [views, persistExpanded, confirm]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
    persistExpanded(new Set());
  }, [persistExpanded]);

  /* -- Add-item form / edit modal -------------------------------------- */

  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const editingItem = editingItemId ? data.items.find((it) => it.id === editingItemId) ?? null : null;

  /* -- Context + virtualisation ---------------------------------------- */

  // Keep the toggle-selected callback stable across renders. Shift-click
  // range select depends on the current visibleOrderedIds, but we don't want
  // the context value to churn whenever that list changes — stash it in a
  // ref and read it inside the stable callback.
  const visibleOrderedIdsRef = useRef(visibleOrderedIds);
  useEffect(() => {
    visibleOrderedIdsRef.current = visibleOrderedIds;
  }, [visibleOrderedIds]);

  const stableToggleSelected = useCallback(
    (itemId: string, shift: boolean) => {
      onRowSelectionToggle(itemId, shift, visibleOrderedIdsRef.current);
    },
    [onRowSelectionToggle],
  );

  const treeContextValue: TreeContextValue = useMemo(
    () => ({
      data,
      views,
      expanded,
      matches,
      visibleIds,
      selectedSet: selected,
      toggle,
      forceExpand,
      onEditItem: setEditingItemId,
      onToggleSelected: stableToggleSelected,
      onCreateLink: createLink,
      onPatchLink: patchLink,
      onDeleteLink: deleteLink,
      onCreateRecipe: createRecipe,
      onDeleteRecipe: deleteRecipe,
    }),
    [
      data,
      views,
      expanded,
      matches,
      visibleIds,
      selected,
      toggle,
      forceExpand,
      stableToggleSelected,
      createLink,
      patchLink,
      deleteLink,
      createRecipe,
      deleteRecipe,
    ],
  );

  return (
    <div className="tree-root">
      <Toolbar
        query={query}
        setQuery={setQuery}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        tierFilter={tierFilter}
        setTierFilter={setTierFilter}
        tagFilter={tagFilter}
        setTagFilter={setTagFilter}
        availableTags={availableTags}
        view={view}
        setView={setView}
        expandAll={expandAll}
        collapseAll={collapseAll}
        expandedCount={expanded.size}
        matchCount={matches ? matches.size : data.items.length}
        totalCount={data.items.length}
        selectedCount={selected.size}
        onSelectAllVisible={() => setSelected(new Set(visibleOrderedIds))}
        onClearSelection={clearSelection}
      />

      <Legend />

      <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--line)" }}>
        {!showAddItem ? (
          <button className="btn" style={{ fontSize: 12 }} onClick={() => setShowAddItem(true)}>
            + Add new item
          </button>
        ) : (
          <AddItemForm
            kinds={data.kinds}
            onCancel={() => setShowAddItem(false)}
            onSubmit={async (input) => {
              await createItem(input);
              setShowAddItem(false);
            }}
          />
        )}
      </div>

      {view === "tree" ? (
        treeOverCap ? (
          <>
            <div
              style={{
                padding: "10px 14px",
                fontSize: 12,
                color: "var(--muted)",
                borderBottom: "1px solid var(--line)",
                background: "var(--soft)",
              }}
            >
              Search matches {matches?.size.toLocaleString() ?? 0} items —
              showing flat results (tree view skipped above {TREE_RENDER_CAP}{" "}
              visible ancestors).
            </div>
            <FlatView
              items={data.items}
              matches={matches}
              onEditItem={setEditingItemId}
              selectedSet={selected}
              onToggleSelected={(id, shift) =>
                onRowSelectionToggle(id, shift, visibleOrderedIds)
              }
            />
          </>
        ) : (
          <TreeContext.Provider value={treeContextValue}>
            <VirtualRootList roots={rootsToRender} />
          </TreeContext.Provider>
        )
      ) : (
        <FlatView
          items={data.items}
          matches={matches}
          onEditItem={setEditingItemId}
          selectedSet={selected}
          onToggleSelected={(id, shift) => onRowSelectionToggle(id, shift, visibleOrderedIds)}
        />
      )}

      {editingItem && (
        <EditItemModal
          item={editingItem}
          kinds={data.kinds}
          combineThemes={data.combineThemes}
          initialItemThemes={data.itemThemes
            .filter((r) => r.itemId === editingItem.id)
            .map((r) => r.themeCode)}
          onClose={() => setEditingItemId(null)}
          onSave={(patch) => patchItem(editingItem.id, patch)}
          onPublish={() => publishItem(editingItem.id)}
          onUnpublish={() => unpublishItem(editingItem.id)}
          onSetThemes={(themes) => setItemThemes(editingItem.id, themes)}
          onDelete={async () => {
            await deleteItem(editingItem.id);
            setEditingItemId(null);
          }}
        />
      )}

      {selected.size > 0 && (
        <BulkActionsBar
          selectedIds={Array.from(selected)}
          combineThemes={data.combineThemes}
          itemThemes={data.itemThemes}
          availableTags={availableTags}
          onBulkPatch={bulkPatch}
          onBulkDelete={bulkDelete}
          onClear={clearSelection}
        />
      )}

      {confirmDialog}
    </div>
  );
}

/* ========================================================================
 * Toolbar + legend + tooltip
 * ====================================================================== */

function Toolbar({
  query,
  setQuery,
  statusFilter,
  setStatusFilter,
  tierFilter,
  setTierFilter,
  tagFilter,
  setTagFilter,
  availableTags,
  view,
  setView,
  expandAll,
  collapseAll,
  expandedCount,
  matchCount,
  totalCount,
  selectedCount,
  onSelectAllVisible,
  onClearSelection,
}: {
  query: string;
  setQuery: (q: string) => void;
  statusFilter: ItemStatus | "all";
  setStatusFilter: (s: ItemStatus | "all") => void;
  tierFilter: Tier | "all";
  setTierFilter: (t: Tier | "all") => void;
  tagFilter: string;
  setTagFilter: (t: string) => void;
  availableTags: string[];
  view: "tree" | "flat";
  setView: (v: "tree" | "flat") => void;
  expandAll: () => void | Promise<void>;
  collapseAll: () => void;
  expandedCount: number;
  matchCount: number;
  totalCount: number;
  selectedCount: number;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
}) {
  const smallBtn: React.CSSProperties = { fontSize: 12, padding: "4px 10px" };
  const isFiltered = matchCount !== totalCount;
  const selectStyle: React.CSSProperties = {
    padding: "6px 8px",
    fontSize: 12,
    border: "1px solid var(--line)",
    borderRadius: 6,
    background: "var(--card)",
    color: "var(--ink)",
  };
  const [drawerOpen, setDrawerOpen] = useState(false);
  const filters = (
    <>
      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as ItemStatus | "all")}
        style={selectStyle}
      >
        <option value="all">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        value={tierFilter}
        onChange={(e) => setTierFilter(e.target.value as Tier | "all")}
        style={selectStyle}
      >
        <option value="all">All tiers</option>
        {TIER_ORDER.map((t) => (
          <option key={t} value={t}>
            {t} — {TIER[t].name}
          </option>
        ))}
      </select>
      <select
        value={tagFilter}
        onChange={(e) => setTagFilter(e.target.value)}
        style={selectStyle}
        disabled={availableTags.length === 0}
      >
        <option value="all">
          {availableTags.length === 0 ? "No tags" : "All tags"}
        </option>
        {availableTags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <div
        className="tree-view-toggle"
        style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 6, overflow: "hidden" }}
      >
        <button
          type="button"
          onClick={() => setView("tree")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            border: 0,
            background: view === "tree" ? "var(--ink)" : "var(--card)",
            color: view === "tree" ? "var(--bg)" : "var(--ink)",
            cursor: "pointer",
          }}
        >
          Tree
        </button>
        <button
          type="button"
          onClick={() => setView("flat")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            border: 0,
            borderLeft: "1px solid var(--line)",
            background: view === "flat" ? "var(--ink)" : "var(--card)",
            color: view === "flat" ? "var(--bg)" : "var(--ink)",
            cursor: "pointer",
          }}
        >
          Flat
        </button>
      </div>
      {view === "tree" && (
        <>
          <button className="btn" style={smallBtn} onClick={expandAll}>
            Expand all
          </button>
          <button className="btn" style={smallBtn} onClick={collapseAll}>
            Collapse all
          </button>
        </>
      )}
    </>
  );

  return (
    <div
      className="tree-toolbar"
      style={{
        display: "flex",
        gap: 10,
        padding: "10px 14px",
        borderBottom: "1px solid var(--line)",
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <div className="tree-toolbar-row" style={{ display: "contents" }}>
        <input
          type="search"
          placeholder="Filter items by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: "1 1 240px",
            maxWidth: 300,
            padding: "6px 10px",
            fontSize: 13,
            border: "1px solid var(--line)",
            borderRadius: 6,
            background: "var(--card)",
            color: "var(--ink)",
          }}
        />
        <button
          type="button"
          className="btn tree-toolbar-mobile-trigger"
          style={{ ...smallBtn, display: "none" }}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          {drawerOpen ? "Hide filters" : "Filters"}
        </button>
      </div>

      {/* Desktop: filters inline. Mobile: hidden until Filters tapped. */}
      <div className="tree-toolbar-filters-desktop" style={{ display: "contents" }}>
        {filters}
      </div>
      <div className={`tree-toolbar-drawer-filters${drawerOpen ? " is-open" : ""}`} style={{ display: "none", width: "100%" }}>
        {filters}
      </div>

      <div style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
        <button type="button" className="btn" style={smallBtn} onClick={onSelectAllVisible}>
          Select {isFiltered ? "matches" : "all"}
        </button>
        {selectedCount > 0 && (
          <button type="button" className="btn" style={smallBtn} onClick={onClearSelection}>
            Clear ({selectedCount})
          </button>
        )}
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {view === "tree" && `${expandedCount} expanded · `}
          {isFiltered ? `${matchCount} match` : `${totalCount} items`}
        </span>
      </div>
    </div>
  );
}

// Shared tooltip state: only one open at a time. Hover still works via CSS
// for desktop; tap toggles explicit visibility for touch.
let tooltipOpenSeq = 0;
const tooltipListeners = new Set<(id: number | null) => void>();
let currentOpenTooltip: number | null = null;
function setOpenTooltip(id: number | null) {
  currentOpenTooltip = id;
  for (const fn of tooltipListeners) fn(id);
}

function Tooltip({
  children,
  title,
  body,
}: {
  children: React.ReactNode;
  title: string;
  body?: string;
}) {
  const [id] = useState(() => ++tooltipOpenSeq);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const listener = (openId: number | null) => setOpen(openId === id);
    tooltipListeners.add(listener);
    return () => {
      tooltipListeners.delete(listener);
    };
  }, [id]);

  // Dismiss on outside tap / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`[data-tooltip-id="${id}"]`)) setOpenTooltip(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenTooltip(null);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, id]);

  return (
    <span
      className="t-tip"
      data-tooltip-id={id}
      data-tip-open={open ? "1" : "0"}
      style={{ position: "relative", display: "inline-flex" }}
      onClick={(e) => {
        e.stopPropagation();
        setOpenTooltip(currentOpenTooltip === id ? null : id);
      }}
    >
      {children}
      <span className="t-tip-pop" role="tooltip">
        <strong style={{ fontWeight: 600 }}>{title}</strong>
        {body && (
          <>
            <br />
            <span style={{ fontWeight: 400, color: "var(--muted)" }}>{body}</span>
          </>
        )}
      </span>
    </span>
  );
}

function Legend() {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        alignItems: "center",
        padding: "6px 14px",
        borderBottom: "1px solid var(--line)",
        fontSize: 11,
        color: "var(--muted)",
        flexWrap: "wrap",
      }}
    >
      <span>Link type:</span>
      {LINK_TYPES.map((t) => (
        <Tooltip key={t} title={`${t} — ${REL[t].group}`} body={REL[t].desc}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--mono, monospace)" }}>
            <svg width={14} height={6} aria-hidden>
              <line
                x1={0}
                y1={3}
                x2={14}
                y2={3}
                stroke="currentColor"
                strokeWidth={1.2}
                strokeDasharray={REL[t].dash || undefined}
              />
            </svg>
            {t} ({REL[t].group.toLowerCase()})
          </span>
        </Tooltip>
      ))}
      <span style={{ marginLeft: 10 }}>Confidence:</span>
      {CONFIDENCES.map((c) => (
        <Tooltip key={c} title={CONFIDENCE_DESC[c]}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: confidenceDot(c),
              }}
            />
            {c}
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

/* ========================================================================
 * VirtualRootList — windowed render of top-level roots.
 *
 * Scope: we virtualise the roots axis only, not the full flattened tree.
 * Row's expansion body (forms, recipes, children) is deeply recursive and
 * stateful; flattening that too would mean hoisting per-row state into a
 * central store — a bigger refactor that pairs with the server-side
 * lazy-load work.
 *
 * What this bounds: on a 10k-item KB with thousands of roots, DOM mounts are
 * limited to roots whose subtrees intersect the viewport. On both desktop
 * and mobile, scrolling stays smooth because the heavy mount/unmount is
 * confined to this one axis.
 *
 * What this does NOT bound: a single root with a deep expanded subtree
 * still renders every descendant row. "Expand all" has a hard cap elsewhere;
 * individual click-expands do not. If a user drills into a thousand-child
 * item we'll feel it. The lazy-load pass (step 4) addresses that properly
 * by fetching children on demand.
 *
 * Scrolling is on the window, not an inner container — mobile browsers hide
 * their chrome on page scroll, and nested scroll containers break that.
 * ====================================================================== */

const VirtualRootList = memo(function VirtualRootList({ roots }: { roots: string[] }) {
  // Window-scrolling virtualiser: the page scrolls as normal, we just don't
  // mount roots whose subtrees are off-screen. This preserves the previous
  // feel (one page scroll, sticky-like toolbar) while bounding DOM.
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virt = useVirtualizer({
    count: roots.length,
    getScrollElement: () => (typeof window === "undefined" ? null : (window as unknown as HTMLElement)),
    observeElementRect: (instance, cb) => {
      const measure = () =>
        cb({ width: window.innerWidth, height: window.innerHeight });
      // Defer first call: react-virtual sets observers up during render and
      // calling `cb` synchronously can trigger flushSync inside a lifecycle.
      const id = requestAnimationFrame(measure);
      window.addEventListener("resize", measure);
      return () => {
        cancelAnimationFrame(id);
        window.removeEventListener("resize", measure);
      };
    },
    observeElementOffset: (instance, cb) => {
      const notify = () => {
        const rect = parentRef.current?.getBoundingClientRect();
        // Offset is how far the list's top is above the viewport top.
        cb(rect ? -rect.top : 0, true);
      };
      const id = requestAnimationFrame(notify);
      window.addEventListener("scroll", notify, { passive: true });
      window.addEventListener("resize", notify);
      return () => {
        cancelAnimationFrame(id);
        window.removeEventListener("scroll", notify);
        window.removeEventListener("resize", notify);
      };
    },
    scrollToFn: (offset) => {
      const rect = parentRef.current?.getBoundingClientRect();
      const top = (rect ? rect.top + window.scrollY : 0) + offset;
      window.scrollTo({ top, behavior: "auto" });
    },
    estimateSize: () => 32,
    overscan: 10,
    getItemKey: (i) => roots[i],
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const items = virt.getVirtualItems();

  return (
    <div ref={parentRef}>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          height: virt.getTotalSize(),
          position: "relative",
        }}
      >
        {items.map((v) => {
          const rootId = roots[v.index];
          return (
            <li
              key={v.key}
              data-index={v.index}
              ref={virt.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${v.start}px)`,
              }}
            >
              <RootSubtree itemId={rootId} />
            </li>
          );
        })}
      </ul>
    </div>
  );
});

/**
 * One root subtree. Thin wrapper around Row that provides the empty ancestor
 * set and depth=0. Memoised; prop identity is just `itemId`.
 */
const RootSubtree = memo(function RootSubtree({ itemId }: { itemId: string }) {
  const emptyAncestors = useMemo(() => new Set<string>(), []);
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      <Row itemId={itemId} path={itemId} depth={0} edge={null} ancestors={emptyAncestors} />
    </ul>
  );
});

/* ========================================================================
 * Row — single tree node (an item in a lineage). Also renders its recipes
 * and children when expanded.
 * ====================================================================== */

interface RowProps {
  itemId: string;
  path: string;
  depth: number;
  edge: {
    linkId: string;
    type: LinkType;
    confidence: Confidence;
  } | null;
  ancestors: Set<string>;
}

const Row = memo(function Row(props: RowProps) {
  const { itemId, path, depth, edge, ancestors } = props;
  const {
    data,
    views,
    expanded,
    toggle,
    forceExpand,
    matches,
    visibleIds,
    onCreateLink,
    onPatchLink,
    onDeleteLink,
    onCreateRecipe,
    onEditItem,
    selectedSet,
    onToggleSelected,
  } = useTree();
  const isSelected = selectedSet.has(itemId);

  const [showAddChild, setShowAddChild] = useState(false);
  const [editingLink, setEditingLink] = useState<string | null>(null);
  const [showRecipeForm, setShowRecipeForm] = useState(false);

  const item = views.itemById.get(itemId);
  const bucket = views.linksByItem.get(itemId);
  const recipes = views.recipesByItem.get(itemId) ?? [];
  const itemLevel = useMemo(() => bucket?.itemLevel ?? [], [bucket]);
  const recipeLinks = bucket?.recipe ?? new Map<string, LinkRow[]>();

  // Pre-sort item-level links and build a stable edges map so child Row
  // props stay reference-stable across unrelated parent re-renders.
  const sortedItemLevel = useMemo(
    () =>
      itemLevel.slice().sort((a, b) => {
        const an = views.itemById.get(a.targetItemId)?.name ?? "";
        const bn = views.itemById.get(b.targetItemId)?.name ?? "";
        return an.localeCompare(bn);
      }),
    [itemLevel, views],
  );
  const rowEdges = useMemo(() => {
    const m = new Map<string, { linkId: string; type: LinkType; confidence: Confidence }>();
    for (const l of itemLevel) {
      m.set(l.linkId, { linkId: l.linkId, type: l.type, confidence: l.confidence });
    }
    return m;
  }, [itemLevel]);
  const nextAncestors = useMemo(() => {
    const s = new Set(ancestors);
    s.add(itemId);
    return s;
  }, [ancestors, itemId]);

  if (!item) return null;
  // Under a filter, hide any item not in the match-or-ancestor set.
  if (visibleIds && !visibleIds.has(itemId)) return null;

  const totalChildren =
    itemLevel.length + Array.from(recipeLinks.values()).reduce((n, arr) => n + arr.length, 0);
  // When filtering, auto-expand so matches are visible without manual clicks.
  const isExpanded = visibleIds ? true : expanded.has(path);
  const isCycle = ancestors.has(itemId);
  const canExpand = (totalChildren > 0 || recipes.length > 0) && !isCycle;
  const parentCount = views.parentCountByItem.get(itemId) ?? 0;

  // Subtly highlight actual matches (vs ancestors shown for context).
  const isActualMatch = matches ? matches.has(itemId) : false;
  const isAncestorContext = !!visibleIds && !isActualMatch;

  return (
    <li>
      <div
        className="tree-row"
        data-depth={depth}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 14px",
          paddingLeft: 14 + depth * INDENT,
          cursor: canExpand ? "pointer" : "default",
          opacity: isAncestorContext ? 0.65 : 1,
          borderBottom: "1px solid transparent",
          ["--depth" as string]: depth,
        }}
        onClick={() => canExpand && toggle(path)}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => {}}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelected(itemId, e.shiftKey);
          }}
          aria-label={`Select ${item.name}`}
          style={{ cursor: "pointer" }}
        />
        <span
          className="tree-row-chevron"
          style={{
            width: 14,
            display: "inline-block",
            textAlign: "center",
            fontSize: 10,
            color: "var(--muted)",
            userSelect: "none",
          }}
          aria-hidden
        >
          {canExpand ? (isExpanded ? "▾" : "▸") : "·"}
        </span>

        <Tooltip title={`${item.tier} — ${TIER[item.tier].name}`}>
          <span
            className="tree-row-tier"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 20,
              height: 20,
              borderRadius: 4,
              background: tierBg(item.tier),
              color: "var(--card)",
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "var(--mono, monospace)",
              flexShrink: 0,
            }}
          >
            {item.tier}
          </span>
        </Tooltip>

        <span className="tree-row-name" style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</span>
        <Tooltip title={data.kinds.find((k) => k.code === item.kind)?.label ?? item.kind}>
          <span className="tree-row-kind" style={{ fontSize: 11, color: "var(--muted)" }}>{item.kind}</span>
        </Tooltip>

        {edge && (
          <span
            className="tree-row-edge"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
              fontFamily: "var(--mono, monospace)",
              color: "var(--muted)",
              marginLeft: 6,
            }}
          >
            <Tooltip title={`${edge.type} — ${REL[edge.type].group}`} body={REL[edge.type].desc}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <svg width={14} height={6} aria-hidden>
                  <line
                    x1={0}
                    y1={3}
                    x2={14}
                    y2={3}
                    stroke="currentColor"
                    strokeWidth={1.2}
                    strokeDasharray={REL[edge.type].dash || undefined}
                  />
                </svg>
                {edge.type}
              </span>
            </Tooltip>
            <Tooltip title={CONFIDENCE_DESC[edge.confidence]}>
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: confidenceDot(edge.confidence),
                }}
              />
            </Tooltip>
          </span>
        )}

        {item.status !== "live" && <StatusPill status={item.status} />}

        {parentCount > 1 && (
          <Tooltip
            title={`${parentCount} lineages`}
            body="This item has multiple parents. It appears under each one."
          >
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 10,
                border: "1px solid var(--line)",
                color: "var(--muted)",
                marginLeft: 4,
              }}
            >
              ↗ {parentCount}
            </span>
          </Tooltip>
        )}

        {isCycle && (
          <span style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>(cycle)</span>
        )}

        <span
          className="tree-row-actions-inline"
          style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="btn tree-row-btn"
            style={rowBtn}
            onClick={() => {
              forceExpand(path);
              setShowAddChild((v) => !v);
            }}
            title="Add child link"
          >
            + Child
          </button>
          {edge && (
            <>
              <button
                className="btn tree-row-btn"
                style={rowBtn}
                onClick={() => setEditingLink(editingLink === edge.linkId ? null : edge.linkId)}
                title="Edit this link"
              >
                Edit link
              </button>
              <button
                className="btn tree-row-btn"
                style={{ ...rowBtn, color: "#f85149" }}
                onClick={async () => {
                  await onDeleteLink(edge.linkId);
                }}
                title="Delete this link"
              >
                Delete
              </button>
            </>
          )}
          <button
            type="button"
            className="btn tree-row-btn"
            style={rowBtn}
            onClick={() => onEditItem(item.id)}
          >
            Edit item
          </button>
        </span>
        <span
          className="tree-row-actions-overflow"
          style={{ marginLeft: "auto", display: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          <RowActionSheet
            itemName={item.name}
            hasEdge={!!edge}
            onAddChild={() => {
              forceExpand(path);
              setShowAddChild(true);
            }}
            onEditLink={() => edge && setEditingLink(edge.linkId)}
            onDeleteLink={async () => {
              if (!edge) return;
              await onDeleteLink(edge.linkId);
            }}
            onEditItem={() => onEditItem(item.id)}
          />
        </span>
      </div>

      {editingLink && edge && editingLink === edge.linkId && (
        <div style={{ paddingLeft: 14 + (depth + 1) * INDENT }}>
          <EditLinkForm
            current={{ confidence: edge.confidence }}
            onCancel={() => setEditingLink(null)}
            onSubmit={async (patch) => {
              await onPatchLink(edge.linkId, patch);
              setEditingLink(null);
            }}
          />
        </div>
      )}

      {showAddChild && (
        <div style={{ paddingLeft: 14 + (depth + 1) * INDENT }}>
          <AddChildForm
            parentItem={item}
            recipes={recipes}
            items={data.items}
            onCancel={() => setShowAddChild(false)}
            onSubmit={async (input) => {
              await onCreateLink({
                type: input.type,
                targetItemId: input.targetItemId,
                recipeId: input.scope === "recipe" ? input.recipeId : null,
                itemId: input.scope === "item" ? item.id : null,
                confidence: input.confidence,
              });
              setShowAddChild(false);
            }}
          />
        </div>
      )}

      {isExpanded && canExpand && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {/* Recipes with links. Even if no links yet, show the recipe header
              so admins can add links. */}
          {recipes.map((r) => (
            <RecipeGroup
              key={r.id}
              recipe={r}
              parentItem={item}
              path={`${path}/recipe:${r.id}`}
              depth={depth + 1}
              links={recipeLinks.get(r.id) ?? []}
              ancestors={ancestors}
              itemId={itemId}
            />
          ))}

          {/* Item-level links appear as a plain group (no header unless
              recipes exist; otherwise mix would be visually confusing). */}
          {itemLevel.length > 0 && (
            <>
              {recipes.length > 0 && (
                <li
                  style={{
                    padding: "2px 14px 2px",
                    paddingLeft: 14 + (depth + 1) * INDENT,
                    fontSize: 10,
                    fontFamily: "var(--mono, monospace)",
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Item-level links
                </li>
              )}
              {sortedItemLevel.map((l) => (
                <Row
                  key={`${path}/${l.targetItemId}/${l.linkId}`}
                  itemId={l.targetItemId}
                  path={`${path}/${l.targetItemId}`}
                  depth={depth + 1}
                  edge={rowEdges.get(l.linkId)!}
                  ancestors={nextAncestors}
                />
              ))}
            </>
          )}

          {/* Add-recipe affordance at the bottom. */}
          <li
            style={{
              padding: "4px 14px",
              paddingLeft: 14 + (depth + 1) * INDENT,
            }}
          >
            {!showRecipeForm ? (
              <button
                className="btn"
                style={rowBtn}
                onClick={() => setShowRecipeForm(true)}
                title="Recipes group links by alternative ways of making this item"
              >
                + Add recipe
              </button>
            ) : (
              <AddRecipeForm
                onCancel={() => setShowRecipeForm(false)}
                onSubmit={async (label) => {
                  await onCreateRecipe(itemId, label);
                  setShowRecipeForm(false);
                }}
              />
            )}
          </li>
        </ul>
      )}
    </li>
  );
});

const rowBtn: React.CSSProperties = { fontSize: 11, padding: "2px 8px" };

/* ========================================================================
 * RowActionSheet — mobile overflow menu. Renders a ⋯ button that opens a
 * bottom sheet with full action labels. Portal-rendered so it isn't
 * trapped inside the tree-row cell's overflow.
 * ====================================================================== */

function RowActionSheet({
  itemName,
  hasEdge,
  onAddChild,
  onEditLink,
  onDeleteLink,
  onEditItem,
}: {
  itemName: string;
  hasEdge: boolean;
  onAddChild: () => void;
  onEditLink: () => void;
  onDeleteLink: () => void | Promise<void>;
  onEditItem: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);
  const runAnd = (fn: () => void | Promise<void>) => async () => {
    close();
    await fn();
  };

  return (
    <>
      <button
        type="button"
        className="btn tree-row-btn"
        style={{ ...rowBtn, minWidth: 32 }}
        aria-label={`Actions for ${itemName}`}
        onClick={() => setOpen(true)}
      >
        ⋯
      </button>
      {typeof document !== "undefined" &&
        open &&
        createPortal(
          <>
            <div
              onClick={close}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.3)",
                zIndex: 90,
              }}
              aria-hidden
            />
            <div
              role="dialog"
              aria-label={`Actions for ${itemName}`}
              style={{
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 0,
                background: "var(--surface)",
                borderTop: "1.5px solid var(--ink)",
                borderRadius: "12px 12px 0 0",
                boxShadow: "0 -4px 16px rgba(0,0,0,0.15)",
                padding: "12px 16px",
                paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
                zIndex: 100,
                animation: "tree-sheet-up 180ms ease-out",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, fontFamily: "var(--mono, monospace)" }}>
                {itemName}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button type="button" className="btn" style={sheetBtn} onClick={runAnd(onAddChild)}>
                  + Add child link
                </button>
                {hasEdge && (
                  <>
                    <button type="button" className="btn" style={sheetBtn} onClick={runAnd(onEditLink)}>
                      Edit this link
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ ...sheetBtn, borderColor: "#f85149", color: "#f85149" }}
                      onClick={runAnd(onDeleteLink)}
                    >
                      Delete this link
                    </button>
                  </>
                )}
                <button type="button" className="btn" style={sheetBtn} onClick={runAnd(onEditItem)}>
                  Edit item
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ ...sheetBtn, marginTop: 4, background: "var(--soft)" }}
                  onClick={close}
                >
                  Cancel
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

/* ========================================================================
 * RecipeActionSheet — mobile overflow menu for a recipe header row.
 * ====================================================================== */

function RecipeActionSheet({
  label,
  onAddLink,
  onDeleteRecipe,
}: {
  label: string;
  onAddLink: () => void;
  onDeleteRecipe: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);
  const runAnd = (fn: () => void | Promise<void>) => async () => {
    close();
    await fn();
  };

  return (
    <>
      <button
        type="button"
        className="btn tree-row-btn"
        style={{ ...rowBtn, minWidth: 32 }}
        aria-label={`Actions for ${label}`}
        onClick={() => setOpen(true)}
      >
        ⋯
      </button>
      {typeof document !== "undefined" &&
        open &&
        createPortal(
          <>
            <div
              onClick={close}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 90 }}
              aria-hidden
            />
            <div
              role="dialog"
              aria-label={`Actions for ${label}`}
              style={{
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 0,
                background: "var(--surface)",
                borderTop: "1.5px solid var(--ink)",
                borderRadius: "12px 12px 0 0",
                boxShadow: "0 -4px 16px rgba(0,0,0,0.15)",
                padding: "12px 16px",
                paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
                zIndex: 100,
                animation: "tree-sheet-up 180ms ease-out",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, fontFamily: "var(--mono, monospace)" }}>
                {label}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button type="button" className="btn" style={sheetBtn} onClick={runAnd(onAddLink)}>
                  + Link in recipe
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ ...sheetBtn, borderColor: "#f85149", color: "#f85149" }}
                  onClick={runAnd(onDeleteRecipe)}
                >
                  Delete recipe
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ ...sheetBtn, marginTop: 4, background: "var(--soft)" }}
                  onClick={close}
                >
                  Cancel
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

const sheetBtn: React.CSSProperties = {
  width: "100%",
  justifyContent: "center",
  padding: "12px 14px",
  fontSize: 14,
  minHeight: 44,
};

/* ========================================================================
 * RecipeGroup — header row for a recipe inside an item's expansion.
 * ====================================================================== */

interface RecipeGroupProps {
  recipe: RecipeRow;
  parentItem: ItemRow;
  path: string;
  depth: number;
  links: LinkRow[];
  ancestors: Set<string>;
  itemId: string;
}

const RecipeGroup = memo(function RecipeGroup(props: RecipeGroupProps) {
  const { recipe, parentItem, path, depth, links, ancestors, itemId } = props;
  const {
    data,
    views,
    expanded,
    toggle,
    forceExpand,
    visibleIds,
    onCreateLink,
    onDeleteRecipe,
  } = useTree();
  const [showAddChild, setShowAddChild] = useState(false);

  const sortedLinks = useMemo(
    () =>
      links.slice().sort((a, b) => {
        const an = views.itemById.get(a.targetItemId)?.name ?? "";
        const bn = views.itemById.get(b.targetItemId)?.name ?? "";
        return an.localeCompare(bn);
      }),
    [links, views],
  );
  const nextAncestors = useMemo(() => {
    const s = new Set(ancestors);
    s.add(itemId);
    return s;
  }, [ancestors, itemId]);

  // Under a filter, hide this recipe group entirely if none of its link
  // targets are in the visible set — nothing of interest to show.
  if (visibleIds) {
    const anyVisible = links.some((l) => visibleIds.has(l.targetItemId));
    if (!anyVisible) return null;
  }

  const isExpanded = visibleIds ? true : expanded.has(path);
  const canExpand = links.length > 0;

  return (
    <li>
      <div
        className="tree-recipe-row"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 14px",
          paddingLeft: 14 + depth * INDENT,
          cursor: canExpand ? "pointer" : "default",
          background: "color-mix(in srgb, var(--soft) 50%, transparent)",
        }}
        onClick={() => canExpand && toggle(path)}
      >
        <span
          style={{
            width: 14,
            display: "inline-block",
            textAlign: "center",
            fontSize: 10,
            color: "var(--muted)",
          }}
          aria-hidden
        >
          {canExpand ? (isExpanded ? "▾" : "▸") : "·"}
        </span>
        <span
          className="tree-recipe-label"
          style={{
            fontFamily: "var(--mono, monospace)",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          Recipe #{recipe.position}
          {recipe.label ? ` · ${recipe.label}` : ""}
        </span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {links.length} link{links.length === 1 ? "" : "s"}
        </span>
        <span
          className="tree-recipe-actions-inline"
          style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="btn"
            style={rowBtn}
            onClick={() => {
              forceExpand(path);
              setShowAddChild((v) => !v);
            }}
          >
            + Link in recipe
          </button>
          <button
            className="btn"
            style={{ ...rowBtn, color: "#f85149" }}
            onClick={async () => {
              await onDeleteRecipe(recipe.id);
            }}
          >
            Delete recipe
          </button>
        </span>
        <span
          className="tree-recipe-actions-overflow"
          style={{ marginLeft: "auto", display: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          <RecipeActionSheet
            label={`Recipe #${recipe.position}${recipe.label ? ` · ${recipe.label}` : ""}`}
            onAddLink={() => {
              forceExpand(path);
              setShowAddChild(true);
            }}
            onDeleteRecipe={async () => {
              await onDeleteRecipe(recipe.id);
            }}
          />
        </span>
      </div>

      {showAddChild && (
        <div style={{ paddingLeft: 14 + (depth + 1) * INDENT }}>
          <AddChildForm
            parentItem={parentItem}
            recipes={[]}
            items={data.items}
            lockedScope={{ kind: "recipe", recipeId: recipe.id }}
            onCancel={() => setShowAddChild(false)}
            onSubmit={async (input) => {
              await onCreateLink({
                type: input.type,
                targetItemId: input.targetItemId,
                recipeId: recipe.id,
                itemId: null,
                confidence: input.confidence,
              });
              setShowAddChild(false);
            }}
          />
        </div>
      )}

      {isExpanded && canExpand && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {sortedLinks.map((l) => (
            <Row
              key={`${path}/${l.targetItemId}/${l.linkId}`}
              itemId={l.targetItemId}
              path={`${path}/${l.targetItemId}`}
              depth={depth + 1}
              edge={{ linkId: l.linkId, type: l.type, confidence: l.confidence }}
              ancestors={nextAncestors}
            />
          ))}
        </ul>
      )}
    </li>
  );
});

/* ========================================================================
 * Forms — small inline editors.
 * ====================================================================== */

function AddItemForm({
  onSubmit,
  onCancel,
  kinds,
}: {
  onSubmit: (input: { name: string; tier: Tier; kind: ItemKind }) => Promise<void>;
  onCancel: () => void;
  kinds: { code: string; label: string }[];
}) {
  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>("M");
  const defaultKind = kinds.find((k) => k.code === "substance")?.code ?? kinds[0]?.code ?? "";
  const [kind, setKind] = useState<ItemKind>(defaultKind);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        try {
          await onSubmit({ name: name.trim(), tier, kind });
        } finally {
          setBusy(false);
        }
      }}
      className="tree-form"
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
    >
      <input
        placeholder="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        autoFocus
        style={formInput}
      />
      <select value={tier} onChange={(e) => setTier(e.target.value as Tier)} style={formInput}>
        {TIER_ORDER.map((t) => (
          <option key={t} value={t}>
            {t} — {TIER[t].name}
          </option>
        ))}
      </select>
      <select value={kind} onChange={(e) => setKind(e.target.value as ItemKind)} style={formInput}>
        {kinds.map((k) => (
          <option key={k.code} value={k.code}>
            {k.label}
          </option>
        ))}
      </select>
      <button type="submit" className="btn" style={rowBtn} disabled={busy}>
        {busy ? "Adding…" : "Add"}
      </button>
      <button type="button" className="btn" style={rowBtn} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function AddRecipeForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (label: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit(label.trim() || null);
        } finally {
          setBusy(false);
        }
      }}
      className="tree-form"
      style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
    >
      <input
        placeholder="label (optional, e.g. 'combustion')"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        autoFocus
        style={{ ...formInput, minWidth: 240 }}
      />
      <button type="submit" className="btn" style={rowBtn} disabled={busy}>
        {busy ? "…" : "Add recipe"}
      </button>
      <button type="button" className="btn" style={rowBtn} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function EditLinkForm({
  current,
  onSubmit,
  onCancel,
}: {
  current: { confidence: Confidence };
  onSubmit: (patch: { confidence?: Confidence }) => Promise<void>;
  onCancel: () => void;
}) {
  const [confidence, setConfidence] = useState<Confidence>(current.confidence);
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (confidence === current.confidence) {
          onCancel();
          return;
        }
        setBusy(true);
        try {
          await onSubmit({ confidence });
        } finally {
          setBusy(false);
        }
      }}
      className="tree-form"
      style={{
        display: "inline-flex",
        gap: 6,
        alignItems: "center",
        padding: "4px 10px",
        background: "var(--soft)",
        borderRadius: 3,
        margin: "4px 0",
      }}
    >
      <span style={{ fontSize: 11, color: "var(--muted)" }}>Confidence</span>
      <select value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence)} style={formInput}>
        {CONFIDENCES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button type="submit" className="btn" style={rowBtn} disabled={busy}>
        {busy ? "…" : "Save"}
      </button>
      <button type="button" className="btn" style={rowBtn} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function AddChildForm({
  parentItem,
  recipes,
  items,
  lockedScope,
  onSubmit,
  onCancel,
}: {
  parentItem: ItemRow;
  recipes: RecipeRow[];
  items: ItemRow[];
  lockedScope?: { kind: "recipe"; recipeId: string };
  onSubmit: (input: {
    type: LinkType;
    targetItemId: string;
    scope: "recipe" | "item";
    recipeId: string | null;
    confidence: Confidence;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [type, setType] = useState<LinkType>("f");
  const [confidence, setConfidence] = useState<Confidence>("established");
  const [targetQuery, setTargetQuery] = useState("");
  const [targetItemId, setTargetItemId] = useState<string | null>(null);
  const [scope, setScope] = useState<"recipe" | "item">(
    lockedScope ? "recipe" : recipes.length ? "recipe" : "item",
  );
  const [recipeId, setRecipeId] = useState<string | null>(
    lockedScope ? lockedScope.recipeId : recipes[0]?.id ?? null,
  );
  const [busy, setBusy] = useState(false);

  // Only "n" and "s" are legal at item-level. "f", "w", "e" must attach to a
  // recipe (that's the prototype's convention — the schema doesn't enforce
  // it, but we respect it here).
  const typeAllowedForScope = (t: LinkType, s: "recipe" | "item") =>
    s === "recipe" ? ["f", "w", "n", "e"].includes(t) : ["n", "s"].includes(t);

  useEffect(() => {
    if (!typeAllowedForScope(type, scope)) {
      setType(scope === "recipe" ? "f" : "n");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const filteredItems = useMemo(() => {
    const q = targetQuery.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((it) => it.id !== parentItem.id && it.name.toLowerCase().includes(q))
      .slice(0, 10);
  }, [targetQuery, items, parentItem.id]);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!targetItemId) return;
        setBusy(true);
        try {
          await onSubmit({
            type,
            targetItemId,
            scope,
            recipeId: scope === "recipe" ? recipeId : null,
            confidence,
          });
        } finally {
          setBusy(false);
        }
      }}
      className="tree-form"
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
        padding: "6px 10px",
        background: "var(--soft)",
        borderRadius: 3,
        margin: "4px 0",
      }}
    >
      {!lockedScope && recipes.length > 0 && (
        <>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>Scope</label>
          <select value={scope} onChange={(e) => setScope(e.target.value as "recipe" | "item")} style={formInput}>
            <option value="recipe">Recipe-scoped</option>
            <option value="item">Item-level</option>
          </select>
        </>
      )}

      {scope === "recipe" && !lockedScope && recipes.length > 0 && (
        <select value={recipeId ?? ""} onChange={(e) => setRecipeId(e.target.value || null)} style={formInput}>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              Recipe #{r.position}
              {r.label ? ` · ${r.label}` : ""}
            </option>
          ))}
        </select>
      )}

      <select value={type} onChange={(e) => setType(e.target.value as LinkType)} style={formInput}>
        {LINK_TYPES.filter((t) => typeAllowedForScope(t, scope)).map((t) => (
          <option key={t} value={t}>
            {t} — {REL[t].group}
          </option>
        ))}
      </select>

      <select value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence)} style={formInput}>
        {CONFIDENCES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <div style={{ position: "relative", minWidth: 240 }}>
        <input
          placeholder="target item…"
          value={targetQuery}
          onChange={(e) => {
            setTargetQuery(e.target.value);
            setTargetItemId(null);
          }}
          style={formInput}
        />
        {targetQuery && filteredItems.length > 0 && !targetItemId && (
          <ul
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              margin: 0,
              padding: 0,
              listStyle: "none",
              background: "var(--surface)",
              border: "1.5px solid var(--ink)",
              borderRadius: 3,
              maxHeight: 220,
              overflow: "auto",
              zIndex: 20,
              boxShadow: "2px 2px 0 var(--ink)",
            }}
          >
            {filteredItems.map((it) => (
              <li
                key={it.id}
                onMouseDown={() => {
                  setTargetItemId(it.id);
                  setTargetQuery(it.name);
                }}
                style={{
                  padding: "4px 10px",
                  cursor: "pointer",
                  fontSize: 13,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>{it.name}</span>
                <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 11, color: "var(--muted)" }}>
                  {it.tier}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="submit" className="btn" style={rowBtn} disabled={busy || !targetItemId}>
        {busy ? "…" : "Add link"}
      </button>
      <button type="button" className="btn" style={rowBtn} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

const formInput: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  border: "1px solid var(--line)",
  borderRadius: 3,
  background: "var(--card)",
  color: "var(--ink)",
};

/* ========================================================================
 * BulkActionsBar — floating bottom bar for applying actions to the
 * current selection. Collapsed by default (just a count + a "Clear"
 * button); each action expands into an inline form.
 * ====================================================================== */

type BulkMode =
  | { kind: "none" }
  | { kind: "themes" }
  | { kind: "status" }
  | { kind: "add-tag" }
  | { kind: "remove-tag" }
  | { kind: "delete" };

function BulkActionsBar({
  selectedIds,
  combineThemes,
  itemThemes,
  availableTags,
  onBulkPatch,
  onBulkDelete,
  onClear,
}: {
  selectedIds: string[];
  combineThemes: { code: string; label: string }[];
  itemThemes: { itemId: string; themeCode: string }[];
  availableTags: string[];
  onBulkPatch: (ids: string[], patch: Parameters<typeof api.bulkPatchItems>[0]["patch"]) => Promise<void>;
  onBulkDelete: (ids: string[]) => Promise<void>;
  onClear: () => void;
}) {
  const [mode, setMode] = useState<BulkMode>({ kind: "none" });
  const [busy, setBusy] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // For tri-state theme UI: compute per-theme how many of the selected
  // items currently have it.
  const themeCountInSelection = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of itemThemes) {
      if (!selectedSet.has(r.itemId)) continue;
      m.set(r.themeCode, (m.get(r.themeCode) ?? 0) + 1);
    }
    return m;
  }, [itemThemes, selectedSet]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setMode({ kind: "none" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        margin: "0 auto",
        maxWidth: 980,
        background: "var(--surface)",
        border: "1.5px solid var(--ink)",
        boxShadow: "2px 2px 0 var(--ink)",
        borderRadius: 6,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        zIndex: 90,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>{selectedIds.length} selected</strong>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" style={bulkBtn} onClick={() => setMode({ kind: "themes" })} disabled={busy}>
          Edit themes
        </button>
        <button type="button" className="btn" style={bulkBtn} onClick={() => setMode({ kind: "status" })} disabled={busy}>
          Set status
        </button>
        <button type="button" className="btn" style={bulkBtn} onClick={() => setMode({ kind: "add-tag" })} disabled={busy}>
          Add tag
        </button>
        <button type="button" className="btn" style={bulkBtn} onClick={() => setMode({ kind: "remove-tag" })} disabled={busy}>
          Remove tag
        </button>
        <button
          type="button"
          className="btn"
          style={{ ...bulkBtn, borderColor: "#f85149", color: "#f85149" }}
          onClick={() => setMode({ kind: "delete" })}
          disabled={busy}
        >
          Delete
        </button>
        <button type="button" className="btn" style={bulkBtn} onClick={onClear} disabled={busy}>
          Clear
        </button>
      </div>

      {mode.kind === "themes" && (
        <BulkThemesEditor
          combineThemes={combineThemes}
          selectedCount={selectedIds.length}
          themeCountInSelection={themeCountInSelection}
          busy={busy}
          onCancel={() => setMode({ kind: "none" })}
          onApply={(add, remove) =>
            run(async () => {
              await onBulkPatch(selectedIds, { setThemes: { add, remove } });
            })
          }
        />
      )}

      {mode.kind === "status" && (
        <BulkStatusEditor
          busy={busy}
          onCancel={() => setMode({ kind: "none" })}
          onApply={(status) => run(() => onBulkPatch(selectedIds, { status }))}
        />
      )}

      {mode.kind === "add-tag" && (
        <BulkTagEditor
          busy={busy}
          placeholder="tag to add"
          onCancel={() => setMode({ kind: "none" })}
          onApply={(tag) => run(() => onBulkPatch(selectedIds, { addTags: [tag] }))}
        />
      )}

      {mode.kind === "remove-tag" && (
        <BulkTagEditor
          busy={busy}
          placeholder="tag to remove"
          suggestions={availableTags}
          onCancel={() => setMode({ kind: "none" })}
          onApply={(tag) => run(() => onBulkPatch(selectedIds, { removeTags: [tag] }))}
        />
      )}

      {mode.kind === "delete" && (
        <div
          style={{
            padding: 10,
            border: "1.5px solid #f85149",
            borderRadius: 4,
            background: "color-mix(in srgb, #f85149 10%, var(--surface))",
            fontSize: 13,
          }}
        >
          Delete {selectedIds.length} item{selectedIds.length === 1 ? "" : "s"}? Items with incoming links will be
          blocked and reported.
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn"
              style={{ ...bulkBtn, background: "#f85149", borderColor: "#f85149", color: "#fff" }}
              onClick={() => run(() => onBulkDelete(selectedIds))}
              disabled={busy}
            >
              {busy ? "…" : "Delete"}
            </button>
            <button type="button" className="btn" style={bulkBtn} onClick={() => setMode({ kind: "none" })}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const bulkBtn: React.CSSProperties = { fontSize: 12, padding: "6px 12px" };

function BulkThemesEditor({
  combineThemes,
  selectedCount,
  themeCountInSelection,
  busy,
  onCancel,
  onApply,
}: {
  combineThemes: { code: string; label: string }[];
  selectedCount: number;
  themeCountInSelection: Map<string, number>;
  busy: boolean;
  onCancel: () => void;
  onApply: (add: string[], remove: string[]) => Promise<void>;
}) {
  // For each theme, three initial states derived from the selection:
  //  "all": every selected item has it → checked.
  //  "none": no selected item has it → unchecked.
  //  "mixed": some have, some don't → indeterminate.
  // User toggles to "all" (add to everyone) or "none" (remove from everyone).
  // Leaving "mixed" alone means no change for that theme.
  type ThemeState = "all" | "none" | "mixed";
  const initialState: Record<string, ThemeState> = {};
  for (const t of combineThemes) {
    const n = themeCountInSelection.get(t.code) ?? 0;
    initialState[t.code] = n === 0 ? "none" : n === selectedCount ? "all" : "mixed";
  }
  const [state, setState] = useState<Record<string, ThemeState>>(initialState);

  const cycle = (code: string) => {
    setState((prev) => {
      const cur = prev[code];
      const next: ThemeState = cur === "all" ? "none" : "all";
      return { ...prev, [code]: next };
    });
  };

  const add = combineThemes
    .filter((t) => state[t.code] === "all" && initialState[t.code] !== "all")
    .map((t) => t.code);
  const remove = combineThemes
    .filter((t) => state[t.code] === "none" && initialState[t.code] !== "none")
    .map((t) => t.code);

  return (
    <div
      style={{
        padding: 10,
        border: "1px solid var(--line)",
        borderRadius: 4,
        background: "var(--soft)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
        Toggle themes to add to or remove from all {selectedCount} selected items. Mixed states (some have, some
        don&rsquo;t) stay mixed if you don&rsquo;t touch them.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        {combineThemes.map((t) => {
          const s = state[t.code];
          return (
            <label
              key={t.code}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                padding: "4px 10px 4px 4px",
                border: "1px solid var(--line)",
                borderRadius: 12,
                background: s === "all" ? "var(--card)" : "transparent",
                cursor: "pointer",
              }}
              onClick={(e) => {
                e.preventDefault();
                cycle(t.code);
              }}
            >
              <input
                type="checkbox"
                checked={s === "all"}
                ref={(el) => {
                  if (el) el.indeterminate = s === "mixed";
                }}
                onChange={() => cycle(t.code)}
              />
              {t.label}
              <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono, monospace)" }}>
                {themeCountInSelection.get(t.code) ?? 0}/{selectedCount}
              </span>
            </label>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn"
          style={bulkBtn}
          disabled={busy || (add.length === 0 && remove.length === 0)}
          onClick={() => onApply(add, remove)}
        >
          {busy ? "…" : `Apply (${add.length} add, ${remove.length} remove)`}
        </button>
        <button type="button" className="btn" style={bulkBtn} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function BulkStatusEditor({
  busy,
  onCancel,
  onApply,
}: {
  busy: boolean;
  onCancel: () => void;
  onApply: (status: "draft" | "review" | "live") => Promise<void>;
}) {
  const [status, setStatus] = useState<"draft" | "review" | "live">("draft");
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>Set all selected items to:</span>
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value as "draft" | "review" | "live")}
        style={{
          padding: "6px 8px",
          fontSize: 12,
          border: "1px solid var(--line)",
          borderRadius: 6,
          background: "var(--card)",
          color: "var(--ink)",
        }}
      >
        <option value="draft">draft</option>
        <option value="review">review</option>
        <option value="live">live</option>
      </select>
      <button type="button" className="btn" style={bulkBtn} disabled={busy} onClick={() => onApply(status)}>
        {busy ? "…" : "Apply"}
      </button>
      <button type="button" className="btn" style={bulkBtn} onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </div>
  );
}

function BulkTagEditor({
  busy,
  placeholder,
  suggestions,
  onCancel,
  onApply,
}: {
  busy: boolean;
  placeholder: string;
  suggestions?: string[];
  onCancel: () => void;
  onApply: (tag: string) => Promise<void>;
}) {
  const [tag, setTag] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!tag.trim()) return;
        onApply(tag.trim());
      }}
      style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
    >
      <input
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        placeholder={placeholder}
        list={suggestions ? "bulk-tag-suggestions" : undefined}
        autoFocus
        required
        style={{
          padding: "6px 10px",
          fontSize: 12,
          border: "1px solid var(--line)",
          borderRadius: 6,
          background: "var(--card)",
          color: "var(--ink)",
          minWidth: 220,
        }}
      />
      {suggestions && (
        <datalist id="bulk-tag-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <button type="submit" className="btn" style={bulkBtn} disabled={busy || !tag.trim()}>
        {busy ? "…" : "Apply"}
      </button>
      <button type="button" className="btn" style={bulkBtn} onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </form>
  );
}

/* ========================================================================
 * FlatView — table of items that match the current filter.
 * ====================================================================== */

function FlatView({
  items,
  matches,
  onEditItem,
  selectedSet,
  onToggleSelected,
}: {
  items: ItemRow[];
  matches: Set<string> | null;
  onEditItem: (id: string) => void;
  selectedSet: Set<string>;
  onToggleSelected: (itemId: string, shiftKey: boolean) => void;
}) {
  const visible = useMemo(() => {
    const list = matches ? items.filter((it) => matches.has(it.id)) : items;
    return list.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [items, matches]);

  if (visible.length === 0) {
    return (
      <p style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>No items match.</p>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
            <th style={{ ...flatTh, width: 24 }}></th>
            <th style={flatTh}>Name</th>
            <th style={flatTh}>Tier</th>
            <th style={flatTh}>Kind</th>
            <th style={flatTh}>Status</th>
            <th style={flatTh}>Tags</th>
            <th style={flatTh}>Updated</th>
            <th style={flatTh}></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((it) => (
            <tr key={it.id} style={{ borderBottom: "1px solid var(--line)", background: selectedSet.has(it.id) ? "var(--soft)" : undefined }}>
              <td style={flatTd}>
                <input
                  type="checkbox"
                  checked={selectedSet.has(it.id)}
                  onChange={() => {}}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelected(it.id, e.shiftKey);
                  }}
                  aria-label={`Select ${it.name}`}
                  style={{ cursor: "pointer" }}
                />
              </td>
              <td style={flatTd}>
                <span style={{ fontWeight: 500 }}>{it.name}</span>
              </td>
              <td style={flatTd}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: tierBg(it.tier),
                    color: "var(--card)",
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: "var(--mono, monospace)",
                  }}
                >
                  {it.tier}
                </span>
              </td>
              <td style={flatTd}>{it.kind}</td>
              <td style={flatTd}>
                <StatusPill status={it.status} />
              </td>
              <td style={flatTd}>
                <TagsCell tags={it.tags} />
              </td>
              <td style={{ ...flatTd, color: "var(--muted)" }}>
                {new Date(it.updatedAt).toLocaleDateString()}
              </td>
              <td style={flatTd}>
                <button type="button" className="btn" style={rowBtn} onClick={() => onEditItem(it.id)}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const flatTh: React.CSSProperties = { padding: "6px 10px", fontSize: 12, color: "var(--muted)" };
const flatTd: React.CSSProperties = { padding: "6px 10px" };

/**
 * Smart tag truncation: show tags up to a character budget, then a
 * "+N more" chip whose tooltip reveals the full list.
 */
function TagsCell({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>;
  }
  const BUDGET = 24;
  const shown: string[] = [];
  let used = 0;
  for (const t of tags) {
    const next = used + t.length + (shown.length > 0 ? 2 : 0);
    if (next > BUDGET && shown.length > 0) break;
    shown.push(t);
    used = next;
  }
  const hidden = tags.length - shown.length;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", maxWidth: 220 }}>
      {shown.map((t) => (
        <span key={t} style={tagChip}>
          {t}
        </span>
      ))}
      {hidden > 0 && (
        <Tooltip title={`${tags.length} tags`} body={tags.join(", ")}>
          <span style={{ ...tagChip, cursor: "help" }}>+{hidden}</span>
        </Tooltip>
      )}
    </span>
  );
}

const tagChip: React.CSSProperties = {
  fontSize: 11,
  padding: "1px 6px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  color: "var(--muted)",
  fontFamily: "var(--mono, monospace)",
  whiteSpace: "nowrap",
};

/* ========================================================================
 * EditItemModal — portal dialog with full parity to /admin/items/[id].
 * ====================================================================== */

function EditItemModal({
  item,
  kinds,
  combineThemes,
  initialItemThemes,
  onClose,
  onSave,
  onPublish,
  onUnpublish,
  onSetThemes,
  onDelete,
}: {
  item: ItemRow;
  kinds: { code: string; label: string }[];
  combineThemes: { code: string; label: string }[];
  initialItemThemes: string[];
  onClose: () => void;
  onSave: (patch: Partial<Pick<ItemRow, "name" | "tier" | "kind" | "firstAppeared" | "symbol" | "fact" | "tags" | "status" | "isCanary" | "isCombineExcluded">>) => Promise<void>;
  onPublish: () => Promise<void>;
  onUnpublish: () => Promise<void>;
  onSetThemes: (themes: string[]) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(item.name);
  const [tier, setTier] = useState<Tier>(item.tier);
  const [kind, setKind] = useState<ItemKind>(item.kind);
  const [firstAppeared, setFirstAppeared] = useState(item.firstAppeared ?? "");
  const [symbol, setSymbol] = useState(item.symbol ?? "");
  const [fact, setFact] = useState(item.fact);
  const [tagsText, setTagsText] = useState(item.tags.join(", "));
  const [status, setStatus] = useState<ItemStatus>(item.status);
  const [itemThemes, setItemThemesState] = useState<Set<string>>(new Set(initialItemThemes));
  const [themesDirty, setThemesDirty] = useState(false);
  const [isCanary, setIsCanary] = useState(item.isCanary);
  const [isCombineExcluded, setIsCombineExcluded] = useState(item.isCombineExcluded);
  const [busy, setBusy] = useState<null | "save" | "publish" | "delete">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Escape to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("save");
    try {
      await onSave({
        name,
        tier,
        kind,
        firstAppeared: firstAppeared.trim() || null,
        symbol: symbol.trim() || null,
        fact,
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        status,
        isCanary,
        isCombineExcluded,
      });
      if (themesDirty) {
        await onSetThemes(Array.from(itemThemes));
      }
      onClose();
    } catch {
      // toast already shown
    } finally {
      setBusy(null);
    }
  };

  const handlePublish = async () => {
    setBusy("publish");
    try {
      if (status === "live") {
        await onUnpublish();
        setStatus("draft");
      } else {
        await onPublish();
        setStatus("live");
      }
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    setBusy("delete");
    try {
      await onDelete();
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <>
      <div className="cbscrim" onClick={onClose} aria-hidden="true" />
      <section
        className="cbover tree-root-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${item.name}`}
        style={{ maxWidth: 640, width: "min(92vw, 640px)" }}
      >
        <form onSubmit={handleSave}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>Edit item</h3>
            <StatusPill status={status} />
          </div>

          <div
            className="modal-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "110px 1fr",
              gap: "10px 12px",
              alignItems: "center",
            }}
          >
            <label style={modalLabel}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={modalInput} required />

            <label style={modalLabel}>Tier</label>
            <select value={tier} onChange={(e) => setTier(e.target.value as Tier)} style={modalInput}>
              {TIER_ORDER.map((t) => (
                <option key={t} value={t}>
                  {t} — {TIER[t].name}
                </option>
              ))}
            </select>

            <label style={modalLabel}>Kind</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as ItemKind)} style={modalInput}>
              {kinds.map((k) => (
                <option key={k.code} value={k.code}>
                  {k.label}
                </option>
              ))}
            </select>

            <label style={modalLabel}>First appeared</label>
            <input
              value={firstAppeared}
              onChange={(e) => setFirstAppeared(e.target.value)}
              placeholder="13.8bya · 385mya · 10ka · 1994 · -3500"
              style={modalInput}
            />

            <label style={modalLabel}>Symbol</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} style={modalInput} />

            <label style={modalLabel}>Fact</label>
            <textarea value={fact} onChange={(e) => setFact(e.target.value)} rows={3} style={{ ...modalInput, fontFamily: "inherit" }} />

            <label style={modalLabel}>Tags</label>
            <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="comma, separated" style={modalInput} />

            <label style={modalLabel}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)} style={modalInput}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <label style={modalLabel}>Canary</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={isCanary} onChange={(e) => setIsCanary(e.target.checked)} />
              <span style={{ color: "var(--muted)" }}>Flag this item as a canary (not public).</span>
            </label>

            <label style={modalLabel}>Exclude from Combine</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={isCombineExcluded}
                onChange={(e) => setIsCombineExcluded(e.target.checked)}
              />
              <span style={{ color: "var(--muted)" }}>
                Never deal or make in Combine, regardless of theme membership. Safety net
                for items that shouldn&apos;t appear on the board (e.g. big bang).
              </span>
            </label>

            <label style={modalLabel}>Combine themes</label>
            {combineThemes.length === 0 ? (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                No themes defined. Create one in Combine themes admin.
              </span>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {combineThemes.map((t) => {
                  const checked = itemThemes.has(t.code);
                  return (
                    <label
                      key={t.code}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                        padding: "2px 8px 2px 4px",
                        border: "1px solid var(--line)",
                        borderRadius: 12,
                        background: checked ? "var(--soft)" : "transparent",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setItemThemesState((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(t.code);
                            else next.delete(t.code);
                            return next;
                          });
                          setThemesDirty(true);
                        }}
                      />
                      {t.label}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 20,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <button type="submit" className="btn primary" disabled={!!busy}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn" disabled={!!busy} onClick={handlePublish}>
              {busy === "publish" ? "…" : status === "live" ? "Unpublish" : "Publish"}
            </button>
            <Link
              href={`/admin/items/${encodeURIComponent(item.id)}`}
              className="btn"
              style={{ fontSize: 13 }}
            >
              Open full editor
            </Link>
            <button
              type="button"
              className="btn"
              onClick={() => setConfirmDelete(true)}
              disabled={!!busy}
              style={{ marginLeft: "auto", borderColor: "var(--bad, #a62828)", color: "var(--bad, #a62828)" }}
            >
              {busy === "delete" ? "…" : "Delete"}
            </button>
            <button type="button" className="btn" onClick={onClose} disabled={!!busy}>
              Cancel
            </button>
          </div>
        </form>

        {confirmDelete && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: "1.5px solid var(--bad, #a62828)",
              borderRadius: 3,
              background: "color-mix(in srgb, var(--bad, #a62828) 10%, var(--surface))",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Delete &ldquo;{item.name}&rdquo;?</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
              This is irreversible. The server will refuse if anything still links to this item.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={handleDelete}
                style={{ background: "var(--bad, #a62828)", color: "var(--bg)", borderColor: "var(--bad, #a62828)" }}
              >
                Delete
              </button>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </>,
    document.body,
  );
}

const modalLabel: React.CSSProperties = { fontSize: 13, color: "var(--muted)" };
const modalInput: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--line)",
  borderRadius: 4,
  fontFamily: "inherit",
  fontSize: 14,
  width: "100%",
  background: "var(--card)",
  color: "var(--ink)",
};
