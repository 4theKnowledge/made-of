"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { ItemKind, Tier } from "@/db/schema";
import { Pictogram } from "@/pictograms/Pictogram";
import { ItemSearch } from "@/components/common/ItemSearch";

export interface IndexEntry {
  slug: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  symbol: string | null;
}

/**
 * A-Z scrollable list of every item. Mobile-first:
 * - fat 56px tap targets so misses are rare,
 * - sticky letter headers that stay in view while scrolling,
 * - a side rail of letters that jumps to the matching section on tap,
 * - a filter box that narrows in place without losing scroll,
 * - the shared ItemSearch component so users can jump straight into Explore.
 */
export function IndexList({ entries }: { entries: IndexEntry[] }) {
  const [filter, setFilter] = useState("");
  const sectionRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const needle = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!needle) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(needle));
  }, [entries, needle]);

  const sections = useMemo(() => {
    const groups = new Map<string, IndexEntry[]>();
    for (const e of visible) {
      const firstChar = e.name.charAt(0).toUpperCase();
      // Non-alpha heads (e.g. "0", "~") land under "#".
      const key = /^[A-Z]$/.test(firstChar) ? firstChar : "#";
      const list = groups.get(key) ?? [];
      list.push(e);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === "#") return 1;
      if (b === "#") return -1;
      return a.localeCompare(b);
    });
  }, [visible]);

  const availableLetters = new Set(sections.map(([k]) => k));
  const RAIL_LETTERS = [
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
    "#",
  ];

  function jumpTo(letter: string) {
    const el = sectionRefs.current[letter];
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  return (
    <section className="panel" style={{ padding: 0, position: "relative" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "var(--surface)",
          borderBottom: "1.5px solid var(--ink)",
          padding: "10px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <ItemSearch placeholder="Jump to anything — type a name…" />
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Or filter this list…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: 16,
            border: "1px solid var(--line)",
            borderRadius: 3,
            background: "var(--card, var(--surface))",
            color: "var(--ink)",
            fontFamily: "inherit",
          }}
        />
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {visible.length === entries.length
            ? `${entries.length} items`
            : `${visible.length} of ${entries.length} match`}
        </div>
      </div>

      <div style={{ position: "relative", display: "flex" }}>
        <ul style={{ flex: 1, margin: 0, padding: 0, listStyle: "none" }}>
          {sections.length === 0 && (
            <li style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
              No items match &ldquo;{filter}&rdquo;.
            </li>
          )}
          {sections.map(([letter, items]) => (
            <li
              key={letter}
              ref={(el) => {
                sectionRefs.current[letter] = el;
              }}
            >
              <div
                style={{
                  position: "sticky",
                  // Keep sticky letter headers below the search bar (approx 150px tall on mobile).
                  top: 150,
                  zIndex: 10,
                  padding: "6px 14px",
                  fontFamily: "var(--mono, monospace)",
                  fontSize: 12,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  background: "var(--soft)",
                  borderBottom: "1px solid var(--line)",
                  borderTop: "1px solid var(--line)",
                }}
              >
                {letter}
                <span style={{ marginLeft: 10, color: "var(--muted)" }}>
                  {items.length}
                </span>
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {items.map((it) => (
                  <li key={it.slug}>
                    <Link
                      href={`/i/${encodeURIComponent(it.slug)}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 14px",
                        minHeight: 56,
                        color: "var(--ink)",
                        textDecoration: "none",
                        borderBottom: "1px solid var(--line)",
                      }}
                    >
                      <span
                        style={{
                          flex: "0 0 auto",
                          width: 36,
                          height: 36,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Pictogram
                          name={it.name}
                          tier={it.tier}
                          kind={it.kind}
                          symbol={it.symbol}
                          size={36}
                        />
                      </span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 15,
                          lineHeight: 1.25,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {it.name}
                      </span>
                      <span
                        aria-label={`Tier ${it.tier}`}
                        style={{
                          flex: "0 0 auto",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 22,
                          height: 22,
                          borderRadius: 4,
                          background: `var(--t${it.tier})`,
                          color: "var(--surface)",
                          fontFamily: "var(--mono, monospace)",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {it.tier}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        {/* A-Z rail — hidden on narrow screens where it'd steal thumb space. */}
        <nav
          aria-label="Jump to letter"
          className="index-rail"
          style={{
            position: "sticky",
            top: 150,
            alignSelf: "flex-start",
            height: "min(70vh, 600px)",
            display: "none",
            flexDirection: "column",
            justifyContent: "space-around",
            padding: "4px 6px",
            borderLeft: "1px solid var(--line)",
          }}
        >
          {RAIL_LETTERS.map((L) => {
            const enabled = availableLetters.has(L);
            return (
              <button
                key={L}
                type="button"
                onClick={() => enabled && jumpTo(L)}
                disabled={!enabled}
                aria-label={`Jump to ${L}`}
                style={{
                  padding: 0,
                  width: 20,
                  height: 20,
                  border: 0,
                  background: "transparent",
                  color: enabled ? "var(--ink)" : "var(--muted)",
                  opacity: enabled ? 1 : 0.4,
                  fontFamily: "var(--mono, monospace)",
                  fontSize: 11,
                  cursor: enabled ? "pointer" : "default",
                }}
              >
                {L}
              </button>
            );
          })}
        </nav>
      </div>
    </section>
  );
}
