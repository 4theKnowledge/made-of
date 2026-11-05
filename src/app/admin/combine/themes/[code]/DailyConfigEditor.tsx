"use client";

import { useState } from "react";
import type { DailyConfig } from "@/combine/daily-config";

/** Admin editor for `combine_themes.dailyConfig`. Daily runs use a different
 *  shape than endless: capped ages for playtime, lower on-band unlock demand,
 *  and a deterministic "guest ingredient of the day" that drips rare items
 *  into the daily collection over months. */
export function DailyConfigEditor({
  themeCode,
  initial,
  totalAges,
}: {
  themeCode: string;
  initial: DailyConfig | null;
  totalAges: number;
}) {
  const [maxAges, setMaxAges] = useState<string>(initial?.maxAges?.toString() ?? "");
  const [ageNeedScale, setAgeNeedScale] = useState<string>(initial?.ageNeedScale?.toString() ?? "");
  const [guestPerRun, setGuestPerRun] = useState<string>(
    initial?.guestIngredient?.perRun?.toString() ?? "",
  );
  const [guestMinBand, setGuestMinBand] = useState<string>(
    initial?.guestIngredient?.minBand?.toString() ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const payload: DailyConfig = {};
    if (maxAges.trim()) payload.maxAges = Number(maxAges);
    if (ageNeedScale.trim()) payload.ageNeedScale = Number(ageNeedScale);
    if (guestPerRun.trim() || guestMinBand.trim()) {
      payload.guestIngredient = {
        perRun: Number(guestPerRun || "0"),
        minBand: Number(guestMinBand || "1"),
      };
    }
    const body = Object.keys(payload).length ? payload : null;
    try {
      const res = await fetch(`/api/admin/combine-themes/${encodeURIComponent(themeCode)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dailyConfig: body }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(j.message ?? j.error ?? `request_failed_${res.status}`);
      }
      setMsg({ text: "Saved.", kind: "ok" });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirm("Clear daily config? Daily will share the endless config.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/combine-themes/${encodeURIComponent(themeCode)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dailyConfig: null }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(j.message ?? j.error ?? `request_failed_${res.status}`);
      }
      setMaxAges("");
      setAgeNeedScale("");
      setGuestPerRun("");
      setGuestMinBand("");
      setMsg({ text: "Cleared.", kind: "ok" });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
      <Field label="Max ages" hint={`1..${totalAges}. Cap the daily run to this many ages. Leave blank to use all ${totalAges}.`}>
        <input
          type="number"
          min={1}
          max={totalAges}
          value={maxAges}
          onChange={(e) => setMaxAges(e.target.value)}
          style={input}
          placeholder={totalAges.toString()}
        />
      </Field>
      <Field label="Age-need scale" hint="Multiplies unique on-band first-finds required to advance. 1.0 = same as endless. 0.5 = half.">
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
          Per-day deterministic injection of tiles whose output lives above the age cap.
          Lets rare items drip into the daily collection without extending the run.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Per run" hint="0..10. Tiles injected into the tray per run.">
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
          <Field label="Min band" hint="1-based. Guests must live in this band or higher.">
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
        <button type="button" className="btn" disabled={busy} onClick={save} style={smallBtn}>
          {busy ? "…" : "Save"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={clear} style={smallBtn}>
          Clear
        </button>
        {msg && (
          <span style={{ fontSize: 12, color: msg.kind === "err" ? "#f85149" : "var(--good, #2a7a2a)" }}>
            {msg.text}
          </span>
        )}
      </div>
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
const smallBtn: React.CSSProperties = { fontSize: 12, padding: "4px 10px" };
