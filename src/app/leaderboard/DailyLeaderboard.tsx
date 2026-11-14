"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/duration";

type Row = {
  handle: string | null;
  manifestFound: number;
  manifestSize: number;
  turns: number;
  score: number;
  durationMs?: number | null;
};

/** Public leaderboard view for today's Combine daily plus the past 6 days.
 *
 *  Data source: `/api/combine/daily/leaderboard`. The API is public but
 *  submissions behind it are auth-only (see `/api/combine/runs/[id]/finish`), so
 *  every row surfaces a real signed-in user's best attempt. */
export function DailyLeaderboard({
  theme,
  today,
  days,
  targetByDay,
  currentUserHandle,
  maxRows,
  showDayChips = true,
  showGameChip = true,
  showMeta = true,
  variant = "page",
}: {
  theme: string;
  today: string;
  /** 7 day keys, newest first (today → 6 days back). */
  days: string[];
  /** `targetDiscoveries` per day; null for pre-feature days. */
  targetByDay: Record<string, number | null>;
  currentUserHandle: string | null;
  /** Cap the rendered row count. When set, trims the leaderboard to the
   *  top N — used by the in-game sheet preview to show a 10-row teaser. */
  maxRows?: number;
  /** Render the 7-day navigation chips. Off for the sheet preview, which
   *  is pinned to a single day. */
  showDayChips?: boolean;
  /** Render the "Combine Daily" pill at the top. Off for the sheet. */
  showGameChip?: boolean;
  /** Render the `<day> · find N` subtitle. The sheet already shows the
   *  day in its own header. */
  showMeta?: boolean;
  /** `page` adds the outer `.feat` section wrapper used on /leaderboard.
   *  `embed` skips it so the component can live inside another surface
   *  (e.g. the sheet) without double-framing. */
  variant?: "page" | "embed";
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

  // Manifest size per day; T-0244 will swap the "Found" column label
  // for "Manifest" once player UI copy stabilises.
  const manifestSize = targetByDay[selectedDay] ?? null;
  const shown = maxRows != null ? rows.slice(0, maxRows) : rows;
  const Wrapper = variant === "page" ? "section" : "div";

  return (
    <Wrapper className={variant === "page" ? "feat lb-wrap" : "lb-wrap lb-embed"}>
      {showGameChip && (
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
      )}

      {showMeta && (
        <header className="lb-header">
          <span className="lb-sub">
            {selectedDay}
            {manifestSize != null && <span className="lb-target"> · find {manifestSize}</span>}
          </span>
        </header>
      )}

      {showDayChips && (
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
      )}

      {loading ? (
        <p className="lb-muted">Loading…</p>
      ) : error ? (
        <p className="lb-muted">Couldn&apos;t load leaderboard.</p>
      ) : shown.length === 0 ? (
        <p className="lb-muted">No finishes yet for this day.</p>
      ) : (
        <>
          <div className="lb-table-wrap">
            <table className="lb-table">
              <thead>
                <tr>
                  <th className="lb-rank-h">#</th>
                  <th>Player</th>
                  <th className="lb-num-h">Found</th>
                  <th className="lb-num-h">Turns</th>
                  <th className="lb-num-h">Time</th>
                  <th className="lb-num-h">Score</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const isMe =
                    currentUserHandle != null &&
                    r.handle != null &&
                    r.handle === currentUserHandle;
                  return (
                    <tr key={`${i}-${r.handle ?? "anon"}`} className={isMe ? "me" : undefined}>
                      <td className="lb-rank">{i + 1}</td>
                      <td className="lb-player">
                        <span className="lb-player-name">
                          {r.handle ?? <span className="lb-muted">—</span>}
                        </span>
                        {isMe && <span className="lb-youbadge" aria-label="This is you">You</span>}
                      </td>
                      <td className="lb-num">
                        {r.manifestFound}
                        {manifestSize != null && (
                          <span className="lb-muted"> / {manifestSize}</span>
                        )}
                      </td>
                      <td className="lb-num">{r.turns}</td>
                      <td className="lb-num">
                        {r.durationMs != null ? (
                          formatDuration(r.durationMs)
                        ) : (
                          <span className="lb-muted">—</span>
                        )}
                      </td>
                      <td className="lb-num">
                        {r.score.toLocaleString("en")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ol className="lb-cards" aria-label="Leaderboard">
            {shown.map((r, i) => {
              const isMe =
                currentUserHandle != null &&
                r.handle != null &&
                r.handle === currentUserHandle;
              return (
                <li
                  key={`card-${i}-${r.handle ?? "anon"}`}
                  className={`lb-card${isMe ? " me" : ""}`}
                >
                  <div className="lb-card-top">
                    <span className="lb-card-rank">#{i + 1}</span>
                    <span className="lb-card-handle">
                      {r.handle ?? <span className="lb-muted">—</span>}
                    </span>
                    {isMe && (
                      <span className="lb-youbadge" aria-label="This is you">
                        You
                      </span>
                    )}
                    <span className="lb-card-score">
                      {r.score.toLocaleString("en")} pts
                    </span>
                  </div>
                  <div className="lb-card-stats">
                    <span>
                      <b>{r.manifestFound}</b>
                      {manifestSize != null && (
                        <span className="lb-muted">/{manifestSize}</span>
                      )}{" "}
                      found
                    </span>
                    <span className="lb-card-sep" aria-hidden="true">
                      ·
                    </span>
                    <span>
                      <b>{r.turns}</b> turn{r.turns === 1 ? "" : "s"}
                    </span>
                    <span className="lb-card-sep" aria-hidden="true">
                      ·
                    </span>
                    <span>
                      {r.durationMs != null ? (
                        <b>{formatDuration(r.durationMs)}</b>
                      ) : (
                        <span className="lb-muted">—</span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Wrapper>
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
