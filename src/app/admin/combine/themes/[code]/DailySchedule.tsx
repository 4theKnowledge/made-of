"use client";

import { useCallback, useEffect, useState } from "react";
import type { DailyPayload } from "@/combine/daily-schedule";

interface Row {
  day: string;
  payload: DailyPayload;
}

/** Admin review table for the precomputed daily schedule. Shows the next
 *  30 days and a regenerate button that wipes days ≥ today and reschedules.
 *
 *  `itemNamesById` is injected from the server component so we can render
 *  readable guest names without another fetch. */
export function DailySchedule({
  themeCode,
  initial,
  itemNamesById,
}: {
  themeCode: string;
  initial: Row[];
  itemNamesById: Record<string, string>;
}) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" | "info" } | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/admin/combine-themes/${encodeURIComponent(themeCode)}/dailies`);
    if (!res.ok) return;
    const j = (await res.json()) as { schedule: Row[] };
    setRows(j.schedule);
  }, [themeCode]);

  const regenerate = async () => {
    if (!confirm("Wipe days ≥ today and reroll the next 30 days?")) return;
    setBusy(true);
    setMsg(null);
    setUnresolved([]);
    try {
      const res = await fetch(
        `/api/admin/combine-themes/${encodeURIComponent(themeCode)}/dailies/regenerate`,
        { method: "POST" },
      );
      const j = (await res.json()) as {
        ok?: boolean;
        written?: number;
        removed?: number;
        error?: string;
        message?: string;
        unresolvedExamples?: string[];
      };
      if (!res.ok || !j.ok) {
        throw new Error(j.message ?? j.error ?? `request_failed_${res.status}`);
      }
      setMsg({
        text: `Wrote ${j.written} day(s), removed ${j.removed}.`,
        kind: "ok",
      });
      setUnresolved(j.unresolvedExamples ?? []);
      await refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  // Refresh after mount in case the server pre-render is slightly stale.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const anyScheduled = rows.some((r) => r.payload.guestOutputIds.length > 0);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <button type="button" className="btn" disabled={busy} onClick={regenerate} style={smallBtn}>
          {busy ? "…" : "Regenerate schedule (next 30 days)"}
        </button>
        {msg && (
          <span style={{ fontSize: 12, color: msg.kind === "err" ? "#f85149" : "var(--good, #2a7a2a)" }}>
            {msg.text}
          </span>
        )}
      </div>
      {unresolved.length > 0 && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--warn, #a66400)",
            borderRadius: 3,
            padding: 10,
            marginBottom: 10,
            fontSize: 12,
          }}
        >
          <strong style={{ color: "var(--warn, #a66400)" }}>Unresolved guests</strong>
          <div style={{ color: "var(--muted)", marginTop: 4 }}>
            These guest outputs had no recipe path through the capped bundle. They&apos;re
            still listed on their scheduled day but won&apos;t surface in the game.
            Consider raising `maxAges` or lowering the guest `minBand`.
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {unresolved.map((id) => (
              <li key={id} style={{ fontFamily: "var(--mono, monospace)" }}>
                {itemNamesById[id] ?? id}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!anyScheduled && (
        <p style={{ fontSize: 12, color: "var(--muted)" }}>
          No schedule yet. Click Regenerate to build the next 30 days.
        </p>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
              <th style={th}>Day</th>
              <th style={th}>Guests</th>
              <th style={th}>Seed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ ...td, fontFamily: "var(--mono, monospace)" }}>{r.day}</td>
                <td style={td}>
                  {r.payload.guestOutputIds.length === 0 ? (
                    <span style={{ opacity: 0.5 }}>—</span>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {r.payload.guestOutputIds.map((id) => (
                        <span
                          key={id}
                          style={{
                            border: "1px solid var(--line)",
                            borderRadius: 10,
                            padding: "1px 8px",
                            fontSize: 11,
                          }}
                        >
                          {itemNamesById[id] ?? id}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ ...td, fontFamily: "var(--mono, monospace)", opacity: 0.7 }}>
                  {r.payload.seed || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "6px 10px", fontSize: 11, color: "var(--muted)" };
const td: React.CSSProperties = { padding: "6px 10px", verticalAlign: "top" };
const smallBtn: React.CSSProperties = { fontSize: 12, padding: "4px 10px" };
