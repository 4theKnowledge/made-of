"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ItemKind, Tier } from "@/db/schema";
import { Pictogram } from "@/pictograms/Pictogram";

interface Hit {
  code: string;
  name: string;
  slug: string;
  tier: Tier;
  kind: ItemKind;
  symbol: string | null;
}

/**
 * Mobile-first autocomplete search over /api/search.
 *
 * - 48px tap targets, no hover-only state (works on touch).
 * - Pictogram preview + tier badge per result for visual recognition.
 * - Bold match highlighting in the name.
 * - Keyboard nav still works (↑ ↓ Enter Escape) for desktop.
 * - Picking a result navigates via `linkFor(hit)` (defaults to /explore/[code]).
 */
export function ItemSearch({
  placeholder = "Search for anything…",
  linkFor,
  autoFocus = false,
}: {
  placeholder?: string;
  linkFor?: (hit: Hit) => string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { results: Hit[] };
        if (id !== seq.current) return;
        setHits(body.results);
        setCursor(0);
        setOpen(true);
      } catch {
        // ignore
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [q]);

  // Close on outside tap (mobile — can't rely on blur alone).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target || !containerRef.current) return;
      if (!containerRef.current.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
    };
  }, [open]);

  function pick(hit: Hit) {
    const href = linkFor ? linkFor(hit) : `/explore/${hit.code}`;
    setQ("");
    setHits([]);
    setOpen(false);
    inputRef.current?.blur();
    router.push(href);
  }

  const trimmed = q.trim();
  const showEmpty =
    open && !loading && trimmed.length >= 2 && hits.length === 0;

  return (
    <div ref={containerRef} className="itemsearch" style={{ position: "relative", width: "100%" }}>
      <div style={{ position: "relative" }}>
        <svg
          aria-hidden
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            position: "absolute",
            top: "50%",
            left: 14,
            transform: "translateY(-50%)",
            color: "var(--muted)",
            pointerEvents: "none",
          }}
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={q}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQ("");
              setOpen(false);
              inputRef.current?.blur();
              return;
            }
            if (!open || hits.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => (c + 1) % hits.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => (c - 1 + hits.length) % hits.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(hits[cursor]);
            }
          }}
          style={{
            width: "100%",
            padding: "12px 44px 12px 42px",
            fontSize: 16, // prevent iOS zoom-on-focus
            border: "1.5px solid var(--ink)",
            borderRadius: 3,
            background: "var(--surface)",
            color: "var(--ink)",
            fontFamily: "inherit",
            lineHeight: 1.2,
          }}
        />
        {q && (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => {
              setQ("");
              setHits([]);
              setOpen(false);
              inputRef.current?.focus();
            }}
            style={{
              position: "absolute",
              top: "50%",
              right: 10,
              transform: "translateY(-50%)",
              width: 28,
              height: 28,
              padding: 0,
              border: 0,
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 18,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        )}
      </div>

      {open && (hits.length > 0 || showEmpty) && (
        <ul
          role="listbox"
          className="itemsearch-pop"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            margin: "6px 0 0",
            padding: 0,
            listStyle: "none",
            background: "var(--surface)",
            border: "1.5px solid var(--ink)",
            borderRadius: 3,
            boxShadow: "2px 2px 0 var(--ink)",
            maxHeight: "min(60vh, 460px)",
            overflowY: "auto",
            zIndex: 30,
            animation: "itemsearch-slide 140ms ease-out",
          }}
        >
          {showEmpty && (
            <li
              style={{
                padding: "16px 14px",
                fontSize: 14,
                color: "var(--muted)",
                textAlign: "center",
              }}
            >
              No matches for &ldquo;{trimmed}&rdquo;.
            </li>
          )}
          {hits.map((h, i) => (
            <ResultRow
              key={h.code}
              hit={h}
              active={i === cursor}
              query={trimmed}
              onPick={() => pick(h)}
              onHover={() => setCursor(i)}
            />
          ))}
        </ul>
      )}

      <style jsx>{`
        @keyframes itemsearch-slide {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        /* Dampen the fancy animation for folks who ask us to. */
        @media (prefers-reduced-motion: reduce) {
          .itemsearch-pop {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function ResultRow({
  hit,
  active,
  query,
  onPick,
  onHover,
}: {
  hit: Hit;
  active: boolean;
  query: string;
  onPick: () => void;
  onHover: () => void;
}) {
  const segments = useMemo(() => highlightSegments(hit.name, query), [hit.name, query]);
  return (
    <li
      role="option"
      aria-selected={active}
      onMouseDown={(e) => {
        e.preventDefault(); // keep focus on the input so iOS doesn't dismiss the keyboard mid-click
        onPick();
      }}
      onTouchStart={() => {
        // Pre-arm active state so the tap feels instant.
        onHover();
      }}
      onMouseEnter={onHover}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        minHeight: 56,
        cursor: "pointer",
        background: active ? "var(--soft)" : "transparent",
        borderBottom: "1px solid var(--line)",
        transition: "background 90ms ease-out",
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
          name={hit.name}
          tier={hit.tier}
          kind={hit.kind}
          symbol={hit.symbol}
          size={36}
        />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 15, lineHeight: 1.25 }}>
        {segments.map((seg, i) =>
          seg.hit ? (
            <strong key={i} style={{ fontWeight: 700 }}>
              {seg.text}
            </strong>
          ) : (
            <span key={i} style={{ color: "var(--muted)" }}>
              {seg.text}
            </span>
          ),
        )}
      </span>
      <span
        aria-label={`Tier ${hit.tier}`}
        style={{
          flex: "0 0 auto",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: 4,
          background: `var(--t${hit.tier})`,
          color: "var(--surface)",
          fontFamily: "var(--mono, monospace)",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {hit.tier}
      </span>
    </li>
  );
}

function highlightSegments(name: string, query: string) {
  if (!query) return [{ hit: false, text: name }];
  const haystack = name.toLowerCase();
  const needle = query.toLowerCase();
  const idx = haystack.indexOf(needle);
  if (idx < 0) return [{ hit: false, text: name }];
  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + needle.length);
  const after = name.slice(idx + needle.length);
  const out: { hit: boolean; text: string }[] = [];
  if (before) out.push({ hit: false, text: before });
  out.push({ hit: true, text: match });
  if (after) out.push({ hit: false, text: after });
  return out;
}
