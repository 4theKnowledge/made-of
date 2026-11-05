"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Row = {
  handle: string | null;
  found: number;
  turns: number;
  score: number;
};

/** Public leaderboard view for today's Combine daily plus the past 6 days.
 *
 *  Data source: `/api/combine/daily/leaderboard`. The API is public but
 *  submissions behind it are auth-only (see `/api/combine/result`), so
 *  every row surfaces a real signed-in user's best attempt. */
export function DailyLeaderboard({
  theme,
  today,
  days,
  targetByDay,
  currentUserHandle,
}: {
  theme: string;
  today: string;
  /** 7 day keys, newest first (today → 6 days back). */
  days: string[];
  /** `targetDiscoveries` per day; null for pre-feature days. */
  targetByDay: Record<string, number | null>;
  currentUserHandle: string | null;
}) {
  const [selectedDay, setSelectedDay] = useState<string>(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Cache responses per day so chip-flipping is instant on revisit.
  const cacheRef = useRef<Map<string, Row[]>>(new Map());

  const fetchDay = useCallback(
    async (day: string) => {
      const cached = cacheRef.current.get(day);
      if (cached) {
        setRows(cached);
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/combine/daily/leaderboard?day=${day}&theme=${theme}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`request_failed_${res.status}`);
        const j = (await res.json()) as { rows: Row[] };
        cacheRef.current.set(day, j.rows);
        setRows(j.rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [theme],
  );

  useEffect(() => {
    void fetchDay(selectedDay);
  }, [selectedDay, fetchDay]);

  const target = targetByDay[selectedDay] ?? null;

  return (
    <section className="feat lb-wrap">
      <div className="lb-gamechips" role="tablist" aria-label="Pick a game">
        <button
          type="button"
          role="tab"
          aria-selected
          className="lb-gamechip active"
        >
          Combine Daily
        </button>
        {/* Future games slot in here. Disabled ghost chip hints at it: */}
        {/* <button className="lb-gamechip" disabled>Link (soon)</button> */}
      </div>

      <header className="lb-header">
        <span className="lb-sub">
          {selectedDay}
          {target != null && <span className="lb-target"> · target {target}</span>}
        </span>
      </header>

      <div className="lb-daychips" role="tablist" aria-label="Pick a day">
        {days.map((d) => {
          const isActive = d === selectedDay;
          const isToday = d === today;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`lb-daychip${isActive ? " active" : ""}${isToday ? " today" : ""}`}
              onClick={() => setSelectedDay(d)}
            >
              {formatChipLabel(d, isToday)}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="lb-muted">Loading…</p>
      ) : error ? (
        <p className="lb-muted">Couldn&apos;t load leaderboard.</p>
      ) : rows.length === 0 ? (
        <p className="lb-muted">No finishes yet for this day.</p>
      ) : (
        <div className="lb-table-wrap">
          <table className="lb-table">
            <thead>
              <tr>
                <th className="lb-rank-h">#</th>
                <th>Player</th>
                <th className="lb-num-h">Found</th>
                <th className="lb-num-h">Turns</th>
                <th className="lb-num-h lb-score-h">Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isMe =
                  currentUserHandle != null &&
                  r.handle != null &&
                  r.handle === currentUserHandle;
                return (
                  <tr key={`${i}-${r.handle ?? "anon"}`} className={isMe ? "me" : undefined}>
                    <td className="lb-rank">{i + 1}</td>
                    <td className="lb-player">
                      {r.handle ?? <span className="lb-muted">—</span>}
                      {isMe && <span className="lb-youbadge" aria-label="This is you">You</span>}
                      <span className="lb-score-mobile">{r.score.toLocaleString("en")} pts</span>
                    </td>
                    <td className="lb-num">
                      {r.found}
                      {target != null && (
                        <span className="lb-muted"> / {target}</span>
                      )}
                    </td>
                    <td className="lb-num">{r.turns}</td>
                    <td className="lb-num lb-score">
                      {r.score.toLocaleString("en")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Short chip label. "Today" for today; otherwise "Mon 3". */
function formatChipLabel(day: string, isToday: boolean): string {
  if (isToday) return "Today";
  const d = new Date(`${day}T00:00:00Z`);
  const weekday = d.toLocaleDateString("en", { weekday: "short", timeZone: "UTC" });
  const dayNum = d.getUTCDate();
  return `${weekday} ${dayNum}`;
}
