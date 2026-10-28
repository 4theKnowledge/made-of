"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pictogram } from "@/pictograms/Pictogram";
import type { ScratchPickerResult } from "./types";

/**
 * Dialog for picking a new From Scratch target. Filters by difficulty and
 * a free-text query. Shows pictogram tiles grouped by difficulty with par
 * step counts.
 */
export function TargetPicker({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (result: ScratchPickerResult) => void;
  onClose: () => void;
}) {
  const [difficulty, setDifficulty] = useState<string>("easy");
  const [query, setQuery] = useState<string>("");
  const [results, setResults] = useState<ScratchPickerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = new URLSearchParams({ difficulty, q: query });
    fetch(`/api/scratch/picker?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((body: { results: ScratchPickerResult[] }) =>
        setResults(body.results ?? []),
      )
      .finally(() => setLoading(false));
  }, [open, difficulty, query]);

  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <>
      <div className="evbg" onClick={onClose} aria-hidden="true" />
      <aside
        className="evd"
        role="dialog"
        aria-modal="true"
        aria-label="Pick a target"
      >
        <div className="evtop">
          <span className="k">Pick a target</span>
          <button
            ref={closeBtnRef}
            type="button"
            className="x"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="pkseg" role="group" aria-label="Difficulty">
          {(
            [
              ["easy", "Easy", "d1"],
              ["medium", "Medium", "d2"],
              ["hard", "Hard", "d3"],
              ["extra", "Extra", "d4"],
            ] as const
          ).map(([d, label, cls]) => (
            <button
              key={d}
              type="button"
              className={`${cls} ${difficulty === d ? "on" : ""} d${d[0].toUpperCase()}`}
              onClick={() => setDifficulty(d)}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          className="pkq"
          type="search"
          placeholder="Find… e.g. pencil"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {loading ? (
          <p className="msg">Loading…</p>
        ) : results.length === 0 ? (
          <p className="msg">Nothing here. Try a different difficulty.</p>
        ) : (
          <div className="pkgrid">
            {results.map((r) => (
              <button
                key={r.code}
                type="button"
                className="pk"
                onClick={() => {
                  onPick(r);
                  onClose();
                }}
              >
                <Pictogram
                  name={r.name}
                  tier={r.tier}
                  kind={r.kind}
                  symbol={r.symbol}
                />
                <span className="nm">{r.name}</span>
                <span className="n">about {r.par} steps</span>
              </button>
            ))}
          </div>
        )}
      </aside>
    </>,
    document.body,
  );
}
