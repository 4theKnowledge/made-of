"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Confidence, ItemKind, LinkType, Tier } from "@/db/schema";
import { REL } from "@/lib/rel";
import { TIER, KIND } from "@/lib/taxonomy";

export interface TreeData {
  items: { id: string; name: string; tier: Tier; kind: ItemKind }[];
  roots: string[];
  childrenByParent: Record<
    string,
    { linkId: string; targetId: string; type: LinkType; confidence: Confidence }[]
  >;
  parentCountByItem: Record<string, number>;
}

const STORAGE_KEY = "admin:tree:expanded:v1";
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

export function TreeList({ data }: { data: TreeData }) {
  const itemById = useMemo(() => {
    const m = new Map<string, TreeData["items"][number]>();
    for (const it of data.items) m.set(it.id, it);
    return m;
  }, [data.items]);

  // Expanded paths — a path uniquely identifies a node in the tangled tree.
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

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    // Enumerate every reachable path, bounded by a depth cap to avoid
    // runaway on cycles / highly-shared items.
    const MAX_DEPTH = 8;
    const all = new Set<string>();
    const walk = (itemId: string, path: string, depth: number, seen: Set<string>) => {
      if (depth >= MAX_DEPTH) return;
      if (seen.has(itemId)) return;
      const kids = data.childrenByParent[itemId];
      if (!kids?.length) return;
      all.add(path);
      const nextSeen = new Set(seen);
      nextSeen.add(itemId);
      for (const k of kids) {
        walk(k.targetId, `${path}/${k.targetId}`, depth + 1, nextSeen);
      }
    };
    for (const r of data.roots) walk(r, r, 0, new Set());
    setExpanded(all);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(all)));
    } catch {
      // ignore
    }
  }, [data]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    } catch {
      // ignore
    }
  }, []);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    const s = new Set<string>();
    for (const it of data.items) {
      if (it.name.toLowerCase().includes(q)) s.add(it.id);
    }
    return s;
  }, [q, data.items]);

  return (
    <div>
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
          {expanded.size} expanded · {matches ? `${matches.size} match` : `${data.items.length} items`}
        </span>
      </div>

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
        {(["f", "w", "n", "s", "e"] as const).map((t) => (
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
        {(["established", "strong", "debated", "hypothesis"] as const).map((c) => (
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

      <ul style={{ listStyle: "none", margin: 0, padding: "6px 0" }}>
        {data.roots.map((rootId) => (
          <Row
            key={rootId}
            itemId={rootId}
            path={rootId}
            depth={0}
            edge={null}
            data={data}
            itemById={itemById}
            expanded={expanded}
            toggle={toggle}
            ancestors={new Set()}
            matches={matches}
          />
        ))}
      </ul>
    </div>
  );
}

const smallBtn: React.CSSProperties = { fontSize: 12, padding: "4px 10px" };

const CONFIDENCE_DESC: Record<Confidence, string> = {
  established: "Established — settled science",
  strong: "Strong — well supported",
  debated: "Debated — competing views",
  hypothesis: "Hypothesis — speculative",
};

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

interface RowProps {
  itemId: string;
  path: string;
  depth: number;
  edge: { linkId: string; type: LinkType; confidence: Confidence } | null;
  data: TreeData;
  itemById: Map<string, TreeData["items"][number]>;
  expanded: Set<string>;
  toggle: (path: string) => void;
  ancestors: Set<string>;
  matches: Set<string> | null;
}

function Row({ itemId, path, depth, edge, data, itemById, expanded, toggle, ancestors, matches }: RowProps) {
  const item = itemById.get(itemId);
  if (!item) return null;

  const children = data.childrenByParent[itemId] ?? [];
  const isExpanded = expanded.has(path);
  const isCycle = ancestors.has(itemId);
  const hasChildren = children.length > 0 && !isCycle;
  const parentCount = data.parentCountByItem[itemId] ?? 0;

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
          cursor: hasChildren ? "pointer" : "default",
          opacity: dimmed ? 0.4 : 1,
          borderBottom: "1px solid transparent",
        }}
        onClick={() => hasChildren && toggle(path)}
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
          {hasChildren ? (isExpanded ? "▾" : "▸") : "·"}
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

        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
          <Link
            href={`/admin/items/${encodeURIComponent(item.id)}`}
            className="btn"
            style={{ fontSize: 11, padding: "2px 8px" }}
            onClick={(e) => e.stopPropagation()}
          >
            Edit
          </Link>
        </span>
      </div>

      {isExpanded && hasChildren && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {children
            .slice()
            .sort((a, b) => {
              const an = itemById.get(a.targetId)?.name ?? "";
              const bn = itemById.get(b.targetId)?.name ?? "";
              return an.localeCompare(bn);
            })
            .map((c) => {
              const nextAncestors = new Set(ancestors);
              nextAncestors.add(itemId);
              return (
                <Row
                  key={`${path}/${c.targetId}/${c.linkId}`}
                  itemId={c.targetId}
                  path={`${path}/${c.targetId}`}
                  depth={depth + 1}
                  edge={{ linkId: c.linkId, type: c.type, confidence: c.confidence }}
                  data={data}
                  itemById={itemById}
                  expanded={expanded}
                  toggle={toggle}
                  ancestors={nextAncestors}
                  matches={matches}
                />
              );
            })}
        </ul>
      )}
    </li>
  );
}
