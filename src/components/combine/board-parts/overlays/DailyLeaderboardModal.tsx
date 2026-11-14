"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";

type Row = {
  handle: string | null;
  manifestFound: number;
  manifestSize: number;
  turns: number;
  durationMs: number | null;
  score: number;
};

const TOP_N = 10;
const NEIGHBOUR_WINDOW = 1;

export function DailyLeaderboardModal({
  open,
  onDismiss,
  day,
  theme,
  currentUserHandle,
  manifestSize,
}: {
  open: boolean;
  onDismiss: () => void;
  day: string;
  theme: string;
  currentUserHandle: string | null;
  /** Optional — when provided, the "found" cell shows `X / N`. */
  manifestSize?: number | null;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRows(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/combine/daily/leaderboard?day=${day}&theme=${theme}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`request_failed_${res.status}`);
        const j = (await res.json()) as { rows: Row[] };
        if (cancelled) return;
        setRows(j.rows);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, day, theme]);

  const myIdx =
    rows && currentUserHandle
      ? rows.findIndex((r) => r.handle === currentUserHandle)
      : -1;

  // Build the display list: top N, then optionally a divider + my neighbours
  // if I'm below the top N.
  let topSlice: Row[] = [];
  let neighbourSlice: Row[] = [];
  let showDivider = false;
  if (rows) {
    topSlice = rows.slice(0, TOP_N);
    if (myIdx >= TOP_N) {
      const start = Math.max(TOP_N, myIdx - NEIGHBOUR_WINDOW);
      const end = Math.min(rows.length, myIdx + NEIGHBOUR_WINDOW + 1);
      neighbourSlice = rows.slice(start, end).map((r, i) => ({
        ...r,
        // carry the absolute position back via a tuple when rendering
        __pos: start + i + 1,
      }) as Row & { __pos: number });
      showDivider = true;
    }
  }

  return (
    <ResponsiveSheet
      open={open}
      onDismiss={onDismiss}
      ariaLabel={`Leaderboard for ${day}`}
      className="cblb"
    >
      <button
        type="button"
        className="cbx"
        aria-label="Close leaderboard"
        onClick={onDismiss}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      <span className="k">Daily leaderboard</span>
      <b className="cblb-day">{day}</b>

      {rows === null && !error && (
        <ul className="cblb-rows" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="cblb-row cblb-skeleton" aria-hidden="true">
              <span className="cblb-rank">&nbsp;</span>
              <span className="cblb-player">&nbsp;</span>
              <span className="cblb-num">&nbsp;</span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="sub" style={{ marginTop: 6 }}>
          Couldn&apos;t load the leaderboard.
        </p>
      )}

      {rows && rows.length === 0 && (
        <p className="sub" style={{ marginTop: 6 }}>
          No finishes yet for this day.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="cblb-rows">
          {topSlice.map((r, i) => (
            <Row
              key={`top-${i}`}
              row={r}
              rank={i + 1}
              isMe={
                currentUserHandle != null &&
                r.handle != null &&
                r.handle === currentUserHandle
              }
              manifestSize={manifestSize ?? null}
            />
          ))}
          {showDivider && (
            <li className="cblb-divider" aria-hidden="true">
              ···
            </li>
          )}
          {neighbourSlice.map((r, i) => {
            const pos = (r as Row & { __pos: number }).__pos;
            return (
              <Row
                key={`near-${i}`}
                row={r}
                rank={pos}
                isMe={
                  currentUserHandle != null &&
                  r.handle != null &&
                  r.handle === currentUserHandle
                }
                manifestSize={manifestSize ?? null}
              />
            );
          })}
        </ul>
      )}

      <Link
        href="/leaderboard"
        className="cblb-full"
        onClick={onDismiss}
      >
        View full leaderboard →
      </Link>
    </ResponsiveSheet>
  );
}

function Row({
  row,
  rank,
  isMe,
  manifestSize,
}: {
  row: Row;
  rank: number;
  isMe: boolean;
  manifestSize: number | null;
}) {
  const size = manifestSize ?? (row.manifestSize > 0 ? row.manifestSize : null);
  return (
    <li className={`cblb-row${isMe ? " me" : ""}`}>
      <span className="cblb-rank">#{rank}</span>
      <span className="cblb-player">
        {row.handle ?? <span className="cblb-muted">—</span>}
        {isMe && (
          <span className="cblb-youbadge" aria-label="This is you">
            You
          </span>
        )}
      </span>
      <span className="cblb-num">
        {row.manifestFound}
        {size != null && <span className="cblb-muted"> / {size}</span>}
      </span>
      <span className="cblb-num cblb-score">
        {row.score.toLocaleString("en")}
      </span>
    </li>
  );
}
