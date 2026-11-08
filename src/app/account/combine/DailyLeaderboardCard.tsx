"use client";

// Inline daily leaderboard preview on /account/combine. Lazy-loaded via
// the public `/api/combine/daily/leaderboard` route (same data the live
// daily sidebar reads from). Showing it here is slice 3's entry point —
// a signed-in player can see where they placed on the day they just
// finished without bouncing through the game screen.
//
// Only the "everything" theme has a leaderboard today (see THEMES in the
// API route); this component takes a theme code so it can grow later.

import { useEffect, useMemo, useState } from "react";

type LeaderboardRow = {
  handle: string | null;
  found: number;
  turns: number;
  score: number;
};

type LeaderboardResponse = {
  day: string;
  theme: string;
  rows: LeaderboardRow[];
};

export function DailyLeaderboardCard({
  day,
  theme,
  themeLabel,
  myHandle,
}: {
  day: string;
  theme: string;
  themeLabel: string;
  /** The signed-in user's handle, if set. Used to highlight their row in
   *  the leaderboard when it appears. Leaderboards only surface handles,
   *  so a null handle means the user hasn't picked one yet — their row
   *  will exist but won't be highlighted. */
  myHandle: string | null;
}) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(
      `/api/combine/daily/leaderboard?day=${encodeURIComponent(day)}&theme=${encodeURIComponent(theme)}`,
    )
      .then((r) => (r.ok ? (r.json() as Promise<LeaderboardResponse>) : null))
      .then((payload) => {
        if (cancelled) return;
        if (!payload) {
          setState("error");
          return;
        }
        setData(payload);
        setState("idle");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [day, theme]);

  const myRankIndex = useMemo(() => {
    if (!data || !myHandle) return -1;
    return data.rows.findIndex((r) => r.handle === myHandle);
  }, [data, myHandle]);

  const topRows = data?.rows.slice(0, 10) ?? [];
  const myOutsideTop =
    data && myRankIndex >= 10 ? data.rows[myRankIndex] : null;

  return (
    <section className="feat">
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>Daily leaderboard</h3>
          <p className="small" style={{ margin: 0 }}>
            {themeLabel} · {day}
          </p>
        </div>
        {myRankIndex >= 0 && (
          <div
            style={{
              fontFamily:
                "var(--mono, 'Chivo Mono'), ui-monospace, monospace",
              fontSize: 14,
            }}
            aria-label={`Your rank: ${myRankIndex + 1}`}
          >
            <small style={{ color: "var(--muted)", fontSize: 11 }}>Your rank</small>{" "}
            #{myRankIndex + 1}
          </div>
        )}
      </header>

      {state === "loading" && (
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          Loading…
        </p>
      )}
      {state === "error" && (
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          Couldn&rsquo;t load today&rsquo;s leaderboard.
        </p>
      )}
      {state === "idle" && topRows.length === 0 && (
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          No scores yet for this day.
        </p>
      )}
      {state === "idle" && topRows.length > 0 && (
        <ol
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 4,
            counterReset: "lb",
          }}
        >
          {topRows.map((row, i) => (
            <LeaderRow
              key={`${i}-${row.handle ?? "anon"}`}
              rank={i + 1}
              row={row}
              isMe={myHandle !== null && row.handle === myHandle}
            />
          ))}
          {myOutsideTop && (
            <>
              <li
                aria-hidden="true"
                style={{
                  color: "var(--muted)",
                  fontSize: 11,
                  padding: "4px 12px",
                  textAlign: "center",
                }}
              >
                …
              </li>
              <LeaderRow
                rank={myRankIndex + 1}
                row={myOutsideTop}
                isMe
              />
            </>
          )}
        </ol>
      )}
    </section>
  );
}

function LeaderRow({
  rank,
  row,
  isMe,
}: {
  rank: number;
  row: LeaderboardRow;
  isMe: boolean;
}) {
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr auto",
        alignItems: "baseline",
        gap: 10,
        padding: "6px 12px",
        border: `1.5px solid ${isMe ? "var(--ink)" : "var(--line)"}`,
        borderRadius: 3,
        background: isMe ? "color-mix(in srgb, var(--accent) 10%, var(--surface))" : "var(--surface)",
        fontSize: 13,
      }}
    >
      <span
        style={{
          fontFamily: "var(--mono, 'Chivo Mono'), ui-monospace, monospace",
          color: "var(--muted)",
        }}
      >
        {rank}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <b style={{ fontWeight: isMe ? 700 : 500 }}>
          {row.handle ?? "anonymous"}
        </b>
        {isMe && (
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--accent)",
              marginLeft: 6,
            }}
          >
            you
          </span>
        )}
      </span>
      <span
        style={{
          fontFamily: "var(--mono, 'Chivo Mono'), ui-monospace, monospace",
          fontSize: 12,
          color: "var(--muted)",
          whiteSpace: "nowrap",
        }}
      >
        <b style={{ color: "var(--ink)", fontWeight: 700 }}>{row.found}</b> found ·{" "}
        {row.turns}t · {row.score.toLocaleString()}
      </span>
    </li>
  );
}
