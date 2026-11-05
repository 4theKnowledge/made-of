"use client";

import { Fragment, useCallback, useState } from "react";
import type { DailyConfig } from "@/combine/daily-config";
import type { DailyPayload } from "@/combine/daily-schedule";

export interface ThemeOption {
  code: string;
  label: string;
}

export interface ScheduleRow {
  day: string;
  payload: DailyPayload;
  isPast: boolean;
}

export interface ActivePayload {
  themeCode: string;
  config: DailyConfig;
}

/** Admin page body for /admin/combine/daily. Combines:
 *  - Theme picker (which theme hosts today's daily)
 *  - Daily config form (caps, scale, guest-of-the-day)
 *  - 30-day schedule review table + Regenerate button
 *
 *  Save first, regenerate second — the schedule reads whatever config is
 *  currently saved. A banner highlights that the config has changed since
 *  the last regenerate so the admin doesn't forget. */
export function DailyAdmin({
  themes,
  initialActive,
  initialSchedule,
  itemNamesById,
}: {
  themes: ThemeOption[];
  initialActive: ActivePayload | null;
  initialSchedule: ScheduleRow[];
  itemNamesById: Record<string, string>;
}) {
  const [themeCode, setThemeCode] = useState<string>(
    initialActive?.themeCode ?? themes[0]?.code ?? "",
  );
  const [maxAges, setMaxAges] = useState<string>(
    initialActive?.config.maxAges?.toString() ?? "",
  );
  const [ageNeedScale, setAgeNeedScale] = useState<string>(
    initialActive?.config.ageNeedScale?.toString() ?? "",
  );
  const [guestPerRun, setGuestPerRun] = useState<string>(
    initialActive?.config.guestIngredient?.perRun?.toString() ?? "",
  );
  const [guestMinBand, setGuestMinBand] = useState<string>(
    initialActive?.config.guestIngredient?.minBand?.toString() ?? "",
  );
  const [schedule, setSchedule] = useState<ScheduleRow[]>(initialSchedule);
  const [busy, setBusy] = useState<"save" | "regen" | "clear" | null>(null);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);

  const payloadConfig = useCallback((): DailyConfig => {
    const cfg: DailyConfig = {};
    if (maxAges.trim()) cfg.maxAges = Number(maxAges);
    if (ageNeedScale.trim()) cfg.ageNeedScale = Number(ageNeedScale);
    if (guestPerRun.trim() || guestMinBand.trim()) {
      cfg.guestIngredient = {
        perRun: Number(guestPerRun || "0"),
        minBand: Number(guestMinBand || "1"),
      };
    }
    return cfg;
  }, [maxAges, ageNeedScale, guestPerRun, guestMinBand]);

  const refreshSchedule = useCallback(async () => {
    const res = await fetch("/api/admin/combine/daily");
    if (!res.ok) return;
    const j = (await res.json()) as { schedule: ScheduleRow[] };
    setSchedule(j.schedule);
  }, []);

  const save = async () => {
    setBusy("save");
    setMsg(null);
    try {
      const res = await fetch("/api/admin/combine/daily", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeCode, config: payloadConfig() }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !j.ok) {
        throw new Error(j.message ?? j.error ?? `request_failed_${res.status}`);
      }
      setMsg({ text: "Saved. Click Regenerate to apply to the schedule.", kind: "ok" });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async () => {
    if (!confirm("Wipe days ≥ today and reroll the next 30 days?")) return;
    setBusy("regen");
    setMsg(null);
    setUnresolved([]);
    try {
      const res = await fetch("/api/admin/combine/daily/regenerate", { method: "POST" });
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
      setMsg({ text: `Wrote ${j.written} day(s), removed ${j.removed}.`, kind: "ok" });
      setUnresolved(j.unresolvedExamples ?? []);
      await refreshSchedule();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(null);
    }
  };

  const clearConfig = async () => {
    if (!confirm("Clear daily config? Daily will still play on the chosen theme but with no cap or guests.")) return;
    setBusy("clear");
    setMsg(null);
    try {
      const res = await fetch("/api/admin/combine/daily", { method: "DELETE" });
      if (!res.ok) throw new Error(`request_failed_${res.status}`);
      setMaxAges("");
      setAgeNeedScale("");
      setGuestPerRun("");
      setGuestMinBand("");
      setMsg({ text: "Cleared.", kind: "ok" });
      await refreshSchedule();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="feat">
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Active theme</h3>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
          The daily plays on this theme. Switch themes with care — in-flight player
          saves for today will stay on the previous theme until the day rolls over.
        </p>
        <select
          value={themeCode}
          onChange={(e) => setThemeCode(e.target.value)}
          style={input}
        >
          {themes.map((t) => (
            <option key={t.code} value={t.code}>
              {t.label} ({t.code})
            </option>
          ))}
        </select>
      </section>

      <section className="feat">
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Daily config</h3>
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <Field label="Max ages" hint="Cap the daily run to this many ages. Leave blank for no cap.">
            <input
              type="number"
              min={1}
              max={30}
              value={maxAges}
              onChange={(e) => setMaxAges(e.target.value)}
              style={input}
              placeholder="no cap"
            />
          </Field>
          <Field label="Age-need scale" hint="Multiplies first-finds required to advance each age. 1.0 = same as endless, 0.5 = half.">
            <input
              type="number"
              step="0.05"
              min={0.05}
              max={2}
              value={ageNeedScale}
              onChange={(e) => setAgeNeedScale(e.target.value)}
              style={input}
              placeholder="1.0"
            />
          </Field>
          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 3, padding: 10 }}>
            <legend style={{ fontSize: 12, color: "var(--muted)", padding: "0 6px" }}>
              Guest ingredient of the day (optional)
            </legend>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              Per-day deterministic injection of items whose output lives above the age cap.
              Drips rare items into the daily collection over months.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Per run" hint="0..10.">
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={guestPerRun}
                  onChange={(e) => setGuestPerRun(e.target.value)}
                  style={input}
                  placeholder="0"
                />
              </Field>
              <Field label="Min band" hint="1..30. Guests must live in this band or higher.">
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={guestMinBand}
                  onChange={(e) => setGuestMinBand(e.target.value)}
                  style={input}
                  placeholder="1"
                />
              </Field>
            </div>
          </fieldset>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className="btn"
              disabled={busy !== null || !themeCode}
              onClick={save}
              style={smallBtn}
            >
              {busy === "save" ? "…" : "Save"}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={clearConfig} style={smallBtn}>
              Clear
            </button>
            {msg && (
              <span style={{ fontSize: 12, color: msg.kind === "err" ? "#f85149" : "var(--good, #2a7a2a)" }}>
                {msg.text}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="feat">
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Schedule</h3>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
          Past 14 days (read-only, served to players) plus today and the upcoming 30.
          The Railway cron extends the upcoming window nightly; Regenerate wipes
          days <em>after</em> today and rerolls with the saved config. Today&apos;s
          row is protected to avoid shifting guests under an in-flight run.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={regenerate}
            style={smallBtn}
          >
            {busy === "regen" ? "…" : "Regenerate schedule"}
          </button>
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
              These guest outputs had no recipe path through the capped bundle. They
              stay scheduled but won&apos;t surface in the game. Raise Max ages or
              lower Guest min band to fix.
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
        {schedule.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            No schedule yet. Save a config and click Regenerate.
          </p>
        ) : (
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
                {schedule.map((r, i) => {
                  const prev = i > 0 ? schedule[i - 1] : null;
                  const showTodayDivider = prev && prev.isPast && !r.isPast;
                  return (
                    <Fragment key={r.day}>
                      {showTodayDivider && (
                        <tr>
                          <td
                            colSpan={3}
                            style={{
                              padding: "4px 10px",
                              fontSize: 10,
                              textTransform: "uppercase",
                              letterSpacing: "0.08em",
                              color: "var(--muted)",
                              background: "var(--surface)",
                              borderTop: "1px solid var(--line)",
                              borderBottom: "1px solid var(--line)",
                            }}
                          >
                            Today
                          </td>
                        </tr>
                      )}
                      <tr
                        style={{
                          borderBottom: "1px solid var(--line)",
                          opacity: r.isPast ? 0.55 : 1,
                        }}
                      >
                        <td style={{ ...td, fontFamily: "var(--mono, monospace)" }}>
                          {r.day}
                          {r.isPast && (
                            <span style={{ marginLeft: 6, fontSize: 10, color: "var(--muted)" }}>
                              served
                            </span>
                          )}
                        </td>
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
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
      <span>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: "var(--muted)" }}>{hint}</span>}
    </label>
  );
}

const input: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 13,
  border: "1px solid var(--line)",
  borderRadius: 3,
  background: "var(--card)",
  color: "var(--ink)",
  width: "100%",
};
const th: React.CSSProperties = { padding: "6px 10px", fontSize: 11, color: "var(--muted)" };
const td: React.CSSProperties = { padding: "6px 10px", verticalAlign: "top" };
const smallBtn: React.CSSProperties = { fontSize: 12, padding: "4px 10px" };
