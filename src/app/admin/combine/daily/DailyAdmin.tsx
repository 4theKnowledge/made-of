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
      <style>{`
        .cb-daily-guest-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .cb-daily-actions {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }
        .cb-daily-actions button {
          min-height: 36px;
          padding: 6px 14px;
          font-size: 13px;
        }
        .cb-daily-schedule-row {
          display: table-row;
        }
        .cb-daily-schedule-cell-mobile {
          display: none;
        }
        @media (max-width: 640px) {
          .cb-daily-guest-grid {
            grid-template-columns: 1fr;
          }
          .cb-daily-schedule-table {
            display: none;
          }
          .cb-daily-schedule-list {
            display: grid;
            gap: 8px;
          }
          .cb-daily-schedule-card {
            border: 1px solid var(--line);
            border-radius: 4px;
            padding: 8px 10px;
            font-size: 12px;
          }
          .cb-daily-schedule-card.past {
            opacity: 0.6;
          }
          .cb-daily-schedule-card .cb-day {
            font-family: var(--mono, monospace);
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-bottom: 4px;
          }
          .cb-daily-schedule-card .cb-seed {
            font-family: var(--mono, monospace);
            font-size: 10px;
            color: var(--muted);
          }
        }
        @media (min-width: 641px) {
          .cb-daily-schedule-list {
            display: none;
          }
        }
      `}</style>
      <section className="feat">
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Active theme</h3>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
          Which theme&apos;s recipes power today&apos;s daily. Endless and Fast are
          unaffected — they always use the player&apos;s chosen theme. Switching
          here is safe at any time, but players mid-run on today&apos;s daily keep
          the previous theme until the day rolls over (UTC midnight).
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
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
          Tune how long a daily run takes and how much rare content it surfaces.
          A fresh run must finish in one sitting, so the goal is &ldquo;satisfying in
          ~15 minutes&rdquo; for the median player — not a completionist marathon.
        </p>
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <Field
            label="Max ages"
            hint={
              <>
                Caps the daily at this many ages (1 = only age I plays, no progression).{" "}
                Blank → full theme (endless length), typically way too long for a single sitting.
                <br />
                <strong>Lower (3–5)</strong> = shorter, friendlier daily; players reach the end
                and feel finished. <strong>Higher (6–8)</strong> = more content per day but
                longer playtime and lower completion rate.{" "}
                <em>Start at ~5 for the 15-minute target on Everything.</em>
              </>
            }
          >
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
          <Field
            label="Age-need scale"
            hint={
              <>
                Multiplies how many unique on-band first-finds the player must make to leave
                each age. 1.0 matches endless; lower values ask less.
                <br />
                <strong>&lt; 1.0 (e.g. 0.5)</strong> = faster age-ups, shorter run, less
                exhaustive exploration. <strong>&gt; 1.0</strong> = more demanding age-ups
                (rarely wanted for daily).{" "}
                <em>0.4&ndash;0.6 pairs well with a 4&ndash;6 age cap.</em>
              </>
            }
          >
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
          <fieldset
            style={{
              border: "1px solid var(--line)",
              borderRadius: 3,
              padding: 10,
              margin: 0,
              minWidth: 0,
            }}
          >
            <legend style={{ fontSize: 12, color: "var(--muted)", padding: "0 6px" }}>
              Guest ingredient of the day (optional)
            </legend>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              Each day, inject a deterministic set of above-cap recipes into the dealer.
              Everyone sees the same guests; a rotation memory in the scheduler keeps a
              given item out for ~one full cycle before it can repeat. This is what lets
              players discover rare items that normally live past the daily&apos;s age cap.
              Leave Per run at 0 to disable.
            </div>
            <div className="cb-daily-guest-grid">
              <Field
                label="Per run"
                hint={
                  <>
                    How many guest recipes to inject each day.
                    <br />
                    <strong>0</strong> = disabled. <strong>1–2</strong> = a small daily surprise,
                    collection drips in over months. <strong>3+</strong> = heavier — can feel
                    noisy or make the daily harder to parse.{" "}
                    <em>1 or 2 is a good default.</em>
                  </>
                }
              >
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
              <Field
                label="Min band"
                hint={
                  <>
                    Guests must live in this band or higher (1 = earliest, 14 = latest on
                    Everything today). The game auto-raises this to at least &ldquo;cap + 1&rdquo;
                    so guests never overlap the normal daily progression.
                    <br />
                    <strong>Just above the cap</strong> = adjacent rare items players nearly
                    reached. <strong>Much higher</strong> = exotic late-game drops.{" "}
                    <em>Try cap + 1 to start.</em>
                  </>
                }
              >
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
          <div className="cb-daily-actions">
            <button
              type="button"
              className="btn"
              disabled={busy !== null || !themeCode}
              onClick={save}
            >
              {busy === "save" ? "…" : "Save"}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={clearConfig}>
              Clear
            </button>
            {msg && (
              <span style={{ fontSize: 12, color: msg.kind === "err" ? "#f85149" : "var(--good, #2a7a2a)", flexBasis: "100%" }}>
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
        <div className="cb-daily-actions" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={regenerate}
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
          <>
          <div className="cb-daily-schedule-list">
            {schedule.map((r, i) => {
              const prev = i > 0 ? schedule[i - 1] : null;
              const showTodayDivider = prev && prev.isPast && !r.isPast;
              return (
                <Fragment key={`m-${r.day}`}>
                  {showTodayDivider && (
                    <div
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "var(--muted)",
                        padding: "4px 0",
                      }}
                    >
                      — Today —
                    </div>
                  )}
                  <div className={`cb-daily-schedule-card${r.isPast ? " past" : ""}`}>
                    <div className="cb-day">
                      <span>
                        {r.day}
                        {r.isPast && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: "var(--muted)", fontWeight: 400 }}>
                            served
                          </span>
                        )}
                      </span>
                      <span className="cb-seed">seed {r.payload.seed || "—"}</span>
                    </div>
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
                  </div>
                </Fragment>
              );
            })}
          </div>
          <div className="cb-daily-schedule-table" style={{ overflowX: "auto" }}>
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
          </>
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
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
      <span>{label}</span>
      {children}
      {hint && (
        <span style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

const input: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid var(--line)",
  borderRadius: 3,
  background: "var(--card)",
  color: "var(--ink)",
  width: "100%",
  // box-sizing: border-box is essential whenever width is 100% and the
  // element has padding/border — otherwise the element overflows its
  // container by the padding + border width. The project's global
  // stylesheet doesn't set this universally (see docs/BANDS.html follow-up
  // task), so set it inline here.
  boxSizing: "border-box",
};
const th: React.CSSProperties = { padding: "6px 10px", fontSize: 11, color: "var(--muted)" };
const td: React.CSSProperties = { padding: "6px 10px", verticalAlign: "top" };
