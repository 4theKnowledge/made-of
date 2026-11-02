"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Confidence, ItemKind, LinkType, Tier } from "@/db/schema";
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
      await mutate(
        (d) => ({
          ...d,
          items: [...d.items, { id: tempId, ...input }],
        }),
        () => api.createItem(input),
        (result, applied) => ({
          ...applied,
          items: applied.items.map((it) => (it.id === tempId ? { id: result.id, ...input } : it)),
        }),
        "Create item failed",
      );
    },
    [mutate],
  );

  /* -- Filter ---------------------------------------------------------- */

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    const s = new Set<string>();
    for (const it of data.items) if (it.name.toLowerCase().includes(q)) s.add(it.id);
    return s;
  }, [q, data.items]);

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

  /* -- Add-item form ---------------------------------------------------- */

  const [showAddItem, setShowAddItem] = useState(false);

  return (
    <div>
      <Toolbar
        query={query}
        setQuery={setQuery}
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
          />
        ))}
      </ul>

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
  expandAll,
  collapseAll,
  expandedCount,
  matchCount,
  totalCount,
}: {
  query: string;
  setQuery: (q: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  expandedCount: number;
  matchCount: number;
  totalCount: number;
}) {
  const smallBtn: React.CSSProperties = { fontSize: 12, padding: "4px 10px" };
  const isFiltered = matchCount !== totalCount;
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "10px 14px",
        borderBottom: "1px solid var(--line)",
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <input
        type="search"
        placeholder="Filter items by name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          flex: "1 1 240px",
          maxWidth: 360,
          padding: "6px 10px",
          fontSize: 13,
          border: "1px solid var(--line)",
          borderRadius: 6,
          background: "var(--card)",
          color: "var(--ink)",
        }}
      />
      <button className="btn" style={smallBtn} onClick={expandAll}>
        Expand all
      </button>
      <button className="btn" style={smallBtn} onClick={collapseAll}>
        Collapse all
      </button>
      <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
        {expandedCount} expanded · {isFiltered ? `${matchCount} match` : `${totalCount} items`}
      </span>
    </div>
  );
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
  return (
    <span className="t-tip" style={{ position: "relative", display: "inline-flex" }}>
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
        .t-tip:hover .t-tip-pop,
        .t-tip:focus-within .t-tip-pop {
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
  } = props;

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

  const [showAddChild, setShowAddChild] = useState(false);
  const [editingLink, setEditingLink] = useState<string | null>(null);
  const [showRecipeForm, setShowRecipeForm] = useState(false);

  const dimmed = matches && !matches.has(itemId);

  return (
    <li>
      <div
        className="tree-row"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 14px",
          paddingLeft: 14 + depth * INDENT,
          cursor: canExpand ? "pointer" : "default",
          opacity: dimmed ? 0.4 : 1,
          borderBottom: "1px solid transparent",
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

        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
          <button
            className="btn"
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
                className="btn"
                style={rowBtn}
                onClick={() => setEditingLink(editingLink === edge.linkId ? null : edge.linkId)}
                title="Edit this link"
              >
                Edit link
              </button>
              <button
                className="btn"
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
          <Link
            href={`/admin/items/${encodeURIComponent(item.id)}`}
            className="btn"
            style={rowBtn}
          >
            Edit item
          </Link>
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
