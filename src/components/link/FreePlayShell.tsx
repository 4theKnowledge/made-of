"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExploreView } from "@/components/explore/types";
import { LinkBoard } from "./LinkBoard";
import type { DailyItem, DailyPuzzle } from "./types";

interface SearchResult {
  code: string;
  name: string;
}

interface FreeplayStartResponse {
  ok: boolean;
  error?: string;
  par?: number;
  start?: DailyItem;
  goal?: DailyItem;
}

const ERRORS: Record<string, string> = {
  bad_request: "Pick a start and a goal.",
  not_found: "That item isn't in the live set yet.",
  same_item: "Pick two different things.",
  no_path: "No path between those on well-established links. Try another pair.",
};

/**
 * Free Play mode for Link. The user picks a start and a goal from
 * autocomplete over all live items, we validate the pair on the server
 * (established/strong links only), then hand off to LinkBoard with a
 * free-play puzzle ref.
 */
export function FreePlayShell() {
  const [puzzle, setPuzzle] = useState<DailyPuzzle | null>(null);
  const [view, setView] = useState<ExploreView | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  if (puzzle && view) {
    return (
      <LinkBoard
        puzzle={puzzle}
        initialView={view}
        key={`${puzzle.start.code}>${puzzle.goal.code}`}
        onNewFreePlay={() => {
          setPuzzle(null);
          setView(null);
          setError("");
        }}
      />
    );
  }

  return (
    <FreePlayPicker
      busy={busy}
      error={error}
      onStart={async (startCode, goalCode) => {
        setBusy(true);
        setError("");
        try {
          const res = await fetch("/api/link/freeplay/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ start: startCode, goal: goalCode }),
          });
          const body = (await res.json()) as FreeplayStartResponse;
          if (!body.ok || !body.start || !body.goal || body.par === undefined) {
            setError(ERRORS[body.error ?? ""] ?? "Something went wrong.");
            return;
          }
          const vRes = await fetch(`/api/view/${body.start.code}`);
          if (!vRes.ok) {
            setError("Couldn't load that start item.");
            return;
          }
          const v = (await vRes.json()) as ExploreView;
          setPuzzle({
            date: "",
            number: 0,
            par: body.par,
            ref: { kind: "free", start: body.start.code, goal: body.goal.code },
            start: body.start,
            goal: body.goal,
          });
          setView(v);
        } catch {
          setError("Network error.");
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

function FreePlayPicker({
  onStart,
  busy,
  error,
}: {
  onStart: (startCode: string, goalCode: string) => void;
  busy: boolean;
  error: string;
}) {
  const [start, setStart] = useState<SearchResult | null>(null);
  const [goal, setGoal] = useState<SearchResult | null>(null);

  return (
    <section className="freeplay">
      <h2 className="freeplayTitle">Free play</h2>
      <p className="freeplaySub">
        Pick two things. We&rsquo;ll check they can be linked by
        well-established recipes, then set you off.
      </p>
      <div className="freeplayRow">
        <ItemCombo
          id="freeplay-start"
          label="Start"
          value={start}
          onChange={setStart}
        />
        <ItemCombo
          id="freeplay-goal"
          label="Goal"
          value={goal}
          onChange={setGoal}
        />
      </div>
      {error && <p className="freeplayErr">{error}</p>}
      <div className="freeplayActions">
        <button
          type="button"
          className="btn primary"
          disabled={!start || !goal || busy}
          onClick={() => {
            if (start && goal) onStart(start.code, goal.code);
          }}
        >
          {busy ? "Checking…" : "Start puzzle"}
        </button>
      </div>
    </section>
  );
}

function ItemCombo({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: SearchResult | null;
  onChange: (v: SearchResult | null) => void;
}) {
  const [q, setQ] = useState(value?.name ?? "");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((body: { results: SearchResult[] }) => {
        setResults(body.results ?? []);
        setActive(0);
      })
      .catch(() => {
        /* aborted */
      });
    return () => ctrl.abort();
  }, [q, open]);

  const pick = useCallback(
    (r: SearchResult) => {
      onChange(r);
      setQ(r.name);
      setOpen(false);
    },
    [onChange],
  );

  return (
    <label className="freeplayField" htmlFor={id}>
      <span className="freeplayLabel">{label}</span>
      <div className="freeplayComboWrap">
        <input
          id={id}
          className="freeplayInput"
          type="search"
          placeholder="Find something…"
          autoComplete="off"
          value={q}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQ(e.target.value);
            onChange(null);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!open || results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(results[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {open && results.length > 0 && (
          <ul className="freeplayMenu" role="listbox">
            {results.map((r, i) => (
              <li
                key={r.code}
                role="option"
                aria-selected={i === active}
                className={i === active ? "on" : ""}
                onMouseDown={() => pick(r)}
              >
                {r.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </label>
  );
}
