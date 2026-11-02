"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Confidence, ItemKind, ItemStatus, LinkType, Tier } from "@/db/schema";
import { REL } from "@/lib/rel";
import { TIER, TIER_ORDER, KIND } from "@/lib/taxonomy";
import { api, type ItemRow, type LinkRow, type RecipeRow } from "./treeApi";

export interface TreeData {
  items: ItemRow[];
  recipes: RecipeRow[];
  links: LinkRow[];
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
const KINDS: ItemKind[] = Object.keys(KIND) as ItemKind[];

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

  // Roots: items with no incoming forward links. (We treat *all* incoming as
  // disqualifying — same as before.)
  const parentCountByItem = new Map<string, number>();
  for (const l of data.links) {
    parentCountByItem.set(l.targetItemId, (parentCountByItem.get(l.targetItemId) ?? 0) + 1);
  }
  const roots = data.items
    .filter((it) => !parentCountByItem.has(it.id))
    .map((it) => it.id);

  return { itemById, recipeById, recipesByItem, linksByItem, parentCountByItem, roots, linkSource };
}

type Views = ReturnType<typeof deriveViews>;

/* ========================================================================
 * Mobile styles. One global style block instead of scattering media queries.
 * Everything targets the .tree-root container so these styles only apply
 * inside this admin tree view, never bleeding to the rest of the site.
 * ====================================================================== */

function TreeMobileStyles() {
  return (
    <style jsx global>{`
      /* Larger tap targets on touch devices without blowing up the layout. */
      @media (hover: none), (max-width: 600px) {
        .tree-root .tree-row-btn {
          min-height: 36px;
          padding: 6px 10px !important;
          font-size: 12px !important;
        }
        .tree-root .tree-row-chevron {
          min-width: 32px !important;
          min-height: 32px !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
      }

      @media (max-width: 600px) {
        /* Toolbar reorganises: search gets full width, filters go behind a
           button that reveals a drawer. */
        .tree-root .tree-toolbar {
          flex-direction: column;
          align-items: stretch !important;
          gap: 8px !important;
        }
        .tree-root .tree-toolbar input[type="search"] {
          max-width: none !important;
          flex: 1 1 auto !important;
        }
        .tree-root .tree-toolbar-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .tree-root .tree-toolbar-drawer-filters {
          display: none !important;
        }
        .tree-root .tree-toolbar-drawer-filters.is-open {
          display: flex !important;
          flex-direction: column;
          gap: 8px;
          padding: 10px 0 0;
        }
        .tree-root .tree-toolbar-drawer-filters.is-open select,
        .tree-root .tree-toolbar-drawer-filters.is-open .tree-view-toggle {
          width: 100%;
          font-size: 14px !important;
        }
        .tree-root .tree-toolbar-drawer-filters.is-open .tree-view-toggle button {
          flex: 1;
          min-height: 36px;
        }

        /* Hide inline row actions behind the overflow menu. */
        .tree-root .tree-row-actions-inline {
          display: none !important;
        }
        .tree-root .tree-row-actions-overflow {
          display: inline-flex !important;
        }

        /* Reduce indent, add lineage guide lines so ancestry stays readable. */
        .tree-root .tree-row {
          position: relative;
        }
        .tree-root .tree-row[data-depth="1"] { padding-left: 24px !important; }
        .tree-root .tree-row[data-depth="2"] { padding-left: 36px !important; }
        .tree-root .tree-row[data-depth="3"] { padding-left: 48px !important; }
        .tree-root .tree-row[data-depth="4"] { padding-left: 60px !important; }
        .tree-root .tree-row[data-depth="5"] { padding-left: 72px !important; }
        .tree-root .tree-row[data-depth="6"] { padding-left: 84px !important; }
        .tree-root .tree-row[data-depth="7"] { padding-left: 96px !important; }
        .tree-root .tree-row[data-depth="8"] { padding-left: 108px !important; }

        .tree-root .tree-row::before {
          content: "";
          position: absolute;
          left: calc(14px + (var(--depth, 0) - 1) * 12px);
          top: 0;
          bottom: 0;
          width: 1px;
          background: var(--line);
          display: var(--guide-display, block);
        }
        .tree-root .tree-row[data-depth="0"]::before { display: none; }

        /* Forms stack vertically on mobile. */
        .tree-root .tree-form {
          flex-direction: column !important;
          align-items: stretch !important;
        }
        .tree-root .tree-form > * {
          width: 100%;
        }
        .tree-root .tree-form select,
        .tree-root .tree-form input {
          font-size: 14px !important;
          padding: 8px 10px !important;
        }
        .tree-root .tree-form button {
          min-height: 36px;
          font-size: 13px !important;
        }
      }

      /* Modal: full-width centered dialog by default; bottom sheet on mobile. */
      @media (max-width: 600px) {
        .tree-root-modal.cbover {
          position: fixed !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          top: auto !important;
          transform: none !important;
          max-height: 92vh;
          max-width: none !important;
          width: 100% !important;
          overflow-y: auto;
          border-radius: 12px 12px 0 0 !important;
          border-left: 0 !important;
          border-right: 0 !important;
          border-bottom: 0 !important;
          padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
          box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.15) !important;
          animation: tree-sheet-up 180ms ease-out;
        }
        .tree-root-modal .modal-grid {
          grid-template-columns: 1fr !important;
          gap: 6px 0 !important;
        }
        .tree-root-modal .modal-grid > label {
          margin-top: 6px;
        }
      }

      @keyframes tree-sheet-up {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }
    `}</style>
  );
}

/* ========================================================================
 * Toast — minimal error surface for failed mutations.
 * ====================================================================== */

interface Toast {
  id: number;
  kind: "error" | "info";
  text: string;
}

function Toasts({ list, dismiss }: { list: Toast[]; dismiss: (id: number) => void }) {
  if (!list.length) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 100,
      }}
    >
      {list.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          style={{
            background: t.kind === "error" ? "#f85149" : "var(--surface)",
            color: t.kind === "error" ? "#fff" : "var(--ink)",
            border: "1.5px solid var(--ink)",
            borderRadius: 3,
            boxShadow: "2px 2px 0 var(--ink)",
            padding: "8px 12px",
            fontSize: 13,
            cursor: "pointer",
            maxWidth: 320,
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ========================================================================
 * TreeList — main component.
 * ====================================================================== */

export function TreeList({ initialData }: { initialData: TreeData }) {
  const [data, setData] = useState<TreeData>(initialData);
  const views = useMemo(() => deriveViews(data), [data]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

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

  // Toasts.
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const toast = useCallback((text: string, kind: Toast["kind"] = "error") => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

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
      await mutate(
        (d) => ({ ...d, links: d.links.filter((l) => l.linkId !== id) }),
        () => api.deleteLink(id),
        undefined,
        "Delete link failed",
      );
    },
    [mutate],
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
    [mutate],
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
      input: Partial<Pick<ItemRow, "name" | "tier" | "kind" | "firstAppeared" | "symbol" | "fact" | "tags" | "status" | "isCanary">>,
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

  /* -- Filter + view --------------------------------------------------- */

  const [statusFilter, setStatusFilter] = useState<ItemStatus | "all">("all");
  const [tierFilter, setTierFilter] = useState<Tier | "all">("all");
  const [view, setView] = useState<"tree" | "flat">("tree");

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const isFiltered = q !== "" || statusFilter !== "all" || tierFilter !== "all";
    if (!isFiltered) return null;
    const s = new Set<string>();
    for (const it of data.items) {
      if (q && !it.name.toLowerCase().includes(q)) continue;
      if (statusFilter !== "all" && it.status !== statusFilter) continue;
      if (tierFilter !== "all" && it.tier !== tierFilter) continue;
      s.add(it.id);
    }
    return s;
  }, [q, statusFilter, tierFilter, data.items]);

  const expandAll = useCallback(() => {
    const MAX_DEPTH = 8;
    const all = new Set<string>();
    const walk = (itemId: string, path: string, depth: number, seen: Set<string>) => {
      if (depth >= MAX_DEPTH || seen.has(itemId)) return;
      const bucket = views.linksByItem.get(itemId);
      const kids = bucket ? [...bucket.itemLevel, ...Array.from(bucket.recipe.values()).flat()] : [];
      if (!kids.length) return;
      all.add(path);
      const next = new Set(seen);
      next.add(itemId);
      for (const k of kids) walk(k.targetItemId, `${path}/${k.targetItemId}`, depth + 1, next);
    };
    for (const r of views.roots) walk(r, r, 0, new Set());
    setExpanded(all);
    persistExpanded(all);
  }, [views, persistExpanded]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
    persistExpanded(new Set());
  }, [persistExpanded]);

  /* -- Add-item form / edit modal -------------------------------------- */

  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const editingItem = editingItemId ? data.items.find((it) => it.id === editingItemId) ?? null : null;

  return (
    <div className="tree-root">
      <TreeMobileStyles />
      <Toolbar
        query={query}
        setQuery={setQuery}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        tierFilter={tierFilter}
        setTierFilter={setTierFilter}
        view={view}
        setView={setView}
        expandAll={expandAll}
        collapseAll={collapseAll}
        expandedCount={expanded.size}
        matchCount={matches ? matches.size : data.items.length}
        totalCount={data.items.length}
      />

      <Legend />

      <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--line)" }}>
        {!showAddItem ? (
          <button className="btn" style={{ fontSize: 12 }} onClick={() => setShowAddItem(true)}>
            + Add new item
          </button>
        ) : (
          <AddItemForm
            onCancel={() => setShowAddItem(false)}
            onSubmit={async (input) => {
              await createItem(input);
              setShowAddItem(false);
            }}
          />
        )}
      </div>

      {view === "tree" ? (
        <ul style={{ listStyle: "none", margin: 0, padding: "6px 0" }}>
          {views.roots.map((rootId) => (
            <Row
              key={rootId}
              itemId={rootId}
              path={rootId}
              depth={0}
              edge={null}
              data={data}
              views={views}
              expanded={expanded}
              toggle={toggle}
              forceExpand={forceExpand}
              ancestors={new Set()}
              matches={matches}
              onCreateLink={createLink}
              onPatchLink={patchLink}
              onDeleteLink={deleteLink}
              onCreateRecipe={createRecipe}
              onDeleteRecipe={deleteRecipe}
              onEditItem={setEditingItemId}
            />
          ))}
        </ul>
      ) : (
        <FlatView items={data.items} matches={matches} onEditItem={setEditingItemId} />
      )}

      {editingItem && (
        <EditItemModal
          item={editingItem}
          onClose={() => setEditingItemId(null)}
          onSave={(patch) => patchItem(editingItem.id, patch)}
          onPublish={() => publishItem(editingItem.id)}
          onUnpublish={() => unpublishItem(editingItem.id)}
          onDelete={async () => {
            await deleteItem(editingItem.id);
            setEditingItemId(null);
          }}
        />
      )}

      <Toasts list={toasts} dismiss={dismissToast} />
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
  view,
  setView,
  expandAll,
  collapseAll,
  expandedCount,
  matchCount,
  totalCount,
}: {
  query: string;
  setQuery: (q: string) => void;
  statusFilter: ItemStatus | "all";
  setStatusFilter: (s: ItemStatus | "all") => void;
  tierFilter: Tier | "all";
  setTierFilter: (t: Tier | "all") => void;
  view: "tree" | "flat";
  setView: (v: "tree" | "flat") => void;
  expandAll: () => void;
  collapseAll: () => void;
  expandedCount: number;
  matchCount: number;
  totalCount: number;
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

      <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
        {view === "tree" && `${expandedCount} expanded · `}
        {isFiltered ? `${matchCount} match` : `${totalCount} items`}
      </span>
      <style jsx>{`
        @media (max-width: 600px) {
          :global(.tree-toolbar-filters-desktop) {
            display: none !important;
          }
          :global(.tree-toolbar-mobile-trigger) {
            display: inline-flex !important;
          }
        }
      `}</style>
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
      <style jsx>{`
        .t-tip {
          cursor: help;
        }
        .t-tip-pop {
          position: absolute;
          bottom: calc(100% + 8px);
          left: 50%;
          transform: translateX(-50%);
          min-width: 160px;
          max-width: 260px;
          padding: 7px 10px;
          background: var(--surface);
          color: var(--ink);
          border: 1.5px solid var(--ink);
          border-radius: 3px;
          font-size: 12px;
          line-height: 1.35;
          font-family: var(--sans, inherit);
          font-weight: 400;
          text-align: left;
          white-space: normal;
          box-shadow: 2px 2px 0 var(--ink);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.08s ease-in;
          z-index: 20;
        }
        /* Hover still works on devices with pointers. */
        @media (hover: hover) {
          .t-tip:hover .t-tip-pop,
          .t-tip:focus-within .t-tip-pop {
            opacity: 1;
          }
        }
        /* Explicit tap-open overrides. */
        .t-tip[data-tip-open="1"] .t-tip-pop {
          opacity: 1;
        }
      `}</style>
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
            {t}
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
  data: TreeData;
  views: Views;
  expanded: Set<string>;
  toggle: (path: string) => void;
  forceExpand: (path: string) => void;
  ancestors: Set<string>;
  matches: Set<string> | null;
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
  onEditItem: (id: string) => void;
}

function Row(props: RowProps) {
  const {
    itemId,
    path,
    depth,
    edge,
    data,
    views,
    expanded,
    toggle,
    forceExpand,
    ancestors,
    matches,
    onCreateLink,
    onPatchLink,
    onDeleteLink,
    onCreateRecipe,
    onDeleteRecipe,
    onEditItem,
  } = props;

  const [showAddChild, setShowAddChild] = useState(false);
  const [editingLink, setEditingLink] = useState<string | null>(null);
  const [showRecipeForm, setShowRecipeForm] = useState(false);

  const item = views.itemById.get(itemId);
  if (!item) return null;

  const bucket = views.linksByItem.get(itemId);
  const recipes = views.recipesByItem.get(itemId) ?? [];
  const itemLevel = bucket?.itemLevel ?? [];
  const recipeLinks = bucket?.recipe ?? new Map<string, LinkRow[]>();

  const totalChildren =
    itemLevel.length + Array.from(recipeLinks.values()).reduce((n, arr) => n + arr.length, 0);
  const isExpanded = expanded.has(path);
  const isCycle = ancestors.has(itemId);
  const canExpand = (totalChildren > 0 || recipes.length > 0) && !isCycle;
  const parentCount = views.parentCountByItem.get(itemId) ?? 0;

  const dimmed = matches && !matches.has(itemId);

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
          opacity: dimmed ? 0.4 : 1,
          borderBottom: "1px solid transparent",
          ["--depth" as string]: depth,
        }}
        onClick={() => canExpand && toggle(path)}
      >
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
            }}
          >
            {item.tier}
          </span>
        </Tooltip>

        <span style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</span>
        <Tooltip title={KIND[item.kind]}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{item.kind}</span>
        </Tooltip>

        {edge && (
          <span
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
                  if (!confirm("Delete this link?")) return;
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
              if (!confirm("Delete this link?")) return;
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
              data={data}
              views={views}
              expanded={expanded}
              toggle={toggle}
              forceExpand={forceExpand}
              ancestors={ancestors}
              itemId={itemId}
              matches={matches}
              onCreateLink={onCreateLink}
              onPatchLink={onPatchLink}
              onDeleteLink={onDeleteLink}
              onDeleteRecipe={onDeleteRecipe}
              onEditItem={onEditItem}
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
              {itemLevel
                .slice()
                .sort((a, b) => {
                  const an = views.itemById.get(a.targetItemId)?.name ?? "";
                  const bn = views.itemById.get(b.targetItemId)?.name ?? "";
                  return an.localeCompare(bn);
                })
                .map((l) => (
                  <Row
                    key={`${path}/${l.targetItemId}/${l.linkId}`}
                    itemId={l.targetItemId}
                    path={`${path}/${l.targetItemId}`}
                    depth={depth + 1}
                    edge={{ linkId: l.linkId, type: l.type, confidence: l.confidence }}
                    data={data}
                    views={views}
                    expanded={expanded}
                    toggle={toggle}
                    forceExpand={forceExpand}
                    ancestors={new Set([...ancestors, itemId])}
                    matches={matches}
                    onCreateLink={onCreateLink}
                    onPatchLink={onPatchLink}
                    onDeleteLink={onDeleteLink}
                    onCreateRecipe={onCreateRecipe}
                    onDeleteRecipe={onDeleteRecipe}
                    onEditItem={onEditItem}
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
}

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
  data: TreeData;
  views: Views;
  expanded: Set<string>;
  toggle: (path: string) => void;
  forceExpand: (path: string) => void;
  ancestors: Set<string>;
  itemId: string;
  matches: Set<string> | null;
  onCreateLink: RowProps["onCreateLink"];
  onPatchLink: RowProps["onPatchLink"];
  onDeleteLink: RowProps["onDeleteLink"];
  onDeleteRecipe: (id: string) => Promise<void>;
  onEditItem: RowProps["onEditItem"];
}

function RecipeGroup(props: RecipeGroupProps) {
  const { recipe, parentItem, path, depth, links, views, expanded, toggle, forceExpand, ancestors, itemId, matches, data } =
    props;
  const isExpanded = expanded.has(path);
  const canExpand = links.length > 0;
  const [showAddChild, setShowAddChild] = useState(false);

  return (
    <li>
      <div
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
          style={{
            fontFamily: "var(--mono, monospace)",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--muted)",
          }}
        >
          Recipe #{recipe.position}
          {recipe.label ? ` · ${recipe.label}` : ""}
        </span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {links.length} link{links.length === 1 ? "" : "s"}
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
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
              if (!confirm(`Delete recipe #${recipe.position}${recipe.label ? ` (${recipe.label})` : ""} and all its links?`))
                return;
              await props.onDeleteRecipe(recipe.id);
            }}
          >
            Delete recipe
          </button>
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
              await props.onCreateLink({
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
          {links
            .slice()
            .sort((a, b) => {
              const an = views.itemById.get(a.targetItemId)?.name ?? "";
              const bn = views.itemById.get(b.targetItemId)?.name ?? "";
              return an.localeCompare(bn);
            })
            .map((l) => (
              <Row
                key={`${path}/${l.targetItemId}/${l.linkId}`}
                itemId={l.targetItemId}
                path={`${path}/${l.targetItemId}`}
                depth={depth + 1}
                edge={{ linkId: l.linkId, type: l.type, confidence: l.confidence }}
                data={data}
                views={views}
                expanded={expanded}
                toggle={toggle}
                forceExpand={forceExpand}
                ancestors={new Set([...ancestors, itemId])}
                matches={matches}
                onCreateLink={props.onCreateLink}
                onPatchLink={props.onPatchLink}
                onDeleteLink={props.onDeleteLink}
                onCreateRecipe={async () => {
                  /* can't add a recipe to a child from here */
                }}
                onDeleteRecipe={props.onDeleteRecipe}
                onEditItem={props.onEditItem}
              />
            ))}
        </ul>
      )}
    </li>
  );
}

/* ========================================================================
 * Forms — small inline editors.
 * ====================================================================== */

function AddItemForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: { name: string; tier: Tier; kind: ItemKind }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>("M");
  const [kind, setKind] = useState<ItemKind>("substance");
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
        {Object.entries(KIND).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
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
 * FlatView — table of items that match the current filter.
 * ====================================================================== */

function FlatView({
  items,
  matches,
  onEditItem,
}: {
  items: ItemRow[];
  matches: Set<string> | null;
  onEditItem: (id: string) => void;
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
            <th style={flatTh}>Name</th>
            <th style={flatTh}>Tier</th>
            <th style={flatTh}>Kind</th>
            <th style={flatTh}>Status</th>
            <th style={flatTh}>Updated</th>
            <th style={flatTh}></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((it) => (
            <tr key={it.id} style={{ borderBottom: "1px solid var(--line)" }}>
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

/* ========================================================================
 * EditItemModal — portal dialog with full parity to /admin/items/[id].
 * ====================================================================== */

function EditItemModal({
  item,
  onClose,
  onSave,
  onPublish,
  onUnpublish,
  onDelete,
}: {
  item: ItemRow;
  onClose: () => void;
  onSave: (patch: Partial<Pick<ItemRow, "name" | "tier" | "kind" | "firstAppeared" | "symbol" | "fact" | "tags" | "status" | "isCanary">>) => Promise<void>;
  onPublish: () => Promise<void>;
  onUnpublish: () => Promise<void>;
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
  const [isCanary, setIsCanary] = useState(item.isCanary);
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
      });
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
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND[k]}
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
