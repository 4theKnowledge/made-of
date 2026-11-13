"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_MANIFEST_PARTNER_BIAS,
  DEFAULT_MANIFEST_SIZE,
  type DailyConfig,
} from "@/combine/daily-config";
import type { DailyPayload } from "@/combine/daily-schedule";
import { todayKey } from "@/combine/rng";
import { useConfirm } from "@/components/common/useConfirm";
import { EditDayModal } from "./EditDayModal";


export interface ThemeOption {
  code: string;
  label: string;
}

interface PoolMember {
  id: string;
  name: string;
}

interface PoolStatsPayload {
  total: number;
  reachable: number;
  solvable: number;
  unsolvable: number;
  unsolvableIds: string[];
  medianDifficulty: number;
  difficultyBuckets: Array<{ range: string; count: number }>;
}

interface ManifestPreview {
  day: string;
  themeCode: string;
  poolSize: number;
  pinned: string[];
  generated: string[];
  manifest: string[];
  turnsToSolve: number;
  poolStats?: PoolStatsPayload;
  clusters?: Array<{ seed: string; members: string[] }> | null;
  sampler?: "cluster" | "single";
}

interface ManifestPreviewError {
  error: string;
  message: string;
  pin?: string;
  manifest?: string[];
  breakers?: Array<{ id: string; difficulty: number | null }> | null;
  poolStats?: PoolStatsPayload;
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
  const [guestPerRun, setGuestPerRun] = useState<string>(
    initialActive?.config.guestIngredient?.perRun?.toString() ?? "",
  );
  const [guestMinBand, setGuestMinBand] = useState<string>(
    initialActive?.config.guestIngredient?.minBand?.toString() ?? "",
  );
  // Manifest config state (T-0243). `manifestPool` empty-string =
  // manifest is disabled; the admin opts in by picking a pool.
  const [manifestPool, setManifestPool] = useState<string>(
    initialActive?.config.manifest?.pool ?? "",
  );
  const [manifestSize, setManifestSize] = useState<string>(
    initialActive?.config.manifest?.size?.toString() ??
      DEFAULT_MANIFEST_SIZE.toString(),
  );
  const [manifestPartnerBias, setManifestPartnerBias] = useState<string>(
    initialActive?.config.manifest?.partnerBias?.toString() ??
      DEFAULT_MANIFEST_PARTNER_BIAS.toString(),
  );
  const [manifestPins, setManifestPins] = useState<string[]>(
    initialActive?.config.manifest?.pins?.slice() ?? [],
  );
  // Pool members for the currently-selected pool. Fetched lazily on
  // pool change — only needed for pin typeahead. `null` = not loaded.
  const [poolMembers, setPoolMembers] = useState<PoolMember[] | null>(null);
  const [poolLoading, setPoolLoading] = useState<boolean>(false);
  const [pinQuery, setPinQuery] = useState<string>("");
  const [preview, setPreview] = useState<ManifestPreview | null>(null);
  const [previewError, setPreviewError] = useState<ManifestPreviewError | null>(null);
  const [previewBusy, setPreviewBusy] = useState<boolean>(false);
  const [schedule, setSchedule] = useState<ScheduleRow[]>(initialSchedule);
  const [busy, setBusy] = useState<"save" | "regen" | "clear" | "reset" | null>(null);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [editingDay, setEditingDay] = useState<ScheduleRow | null>(null);
  const [guestPoolMembers, setGuestPoolMembers] = useState<PoolMember[] | null>(null);

  const payloadConfig = useCallback((): DailyConfig => {
    const cfg: DailyConfig = {};
    if (guestPerRun.trim() || guestMinBand.trim()) {
      cfg.guestIngredient = {
        perRun: Number(guestPerRun || "0"),
        minBand: Number(guestMinBand || "1"),
      };
    }
    if (manifestPool.trim()) {
      const size = Number(manifestSize || DEFAULT_MANIFEST_SIZE);
      const partnerBias = Number(
        manifestPartnerBias || DEFAULT_MANIFEST_PARTNER_BIAS,
      );
      cfg.manifest = {
        pool: manifestPool,
        size,
        partnerBias,
      };
      if (manifestPins.length > 0) cfg.manifest.pins = manifestPins.slice();
    }
    return cfg;
  }, [
    guestPerRun,
    guestMinBand,
    manifestPool,
    manifestSize,
    manifestPartnerBias,
    manifestPins,
  ]);

  // Fetch pool members when the admin picks (or changes) the manifest
  // pool. Kept lazy so visiting the page with no manifest configured
  // doesn't hit the DB for an empty pool.
  useEffect(() => {
    if (!manifestPool) {
      setPoolMembers(null);
      return;
    }
    let cancelled = false;
    setPoolLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/combine/daily/pool-members?pool=${encodeURIComponent(manifestPool)}`,
        );
        if (!res.ok) throw new Error(`pool_fetch_${res.status}`);
        const j = (await res.json()) as { items: PoolMember[] };
        if (!cancelled) setPoolMembers(j.items);
      } catch (e) {
        if (!cancelled) {
          setPoolMembers([]);
          setMsg({
            text: e instanceof Error ? e.message : String(e),
            kind: "err",
          });
        }
      } finally {
        if (!cancelled) setPoolLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manifestPool]);

  // Filtered pin typeahead matches. Excludes already-pinned items.
  const pinSuggestions = useMemo<PoolMember[]>(() => {
    if (!poolMembers) return [];
    const q = pinQuery.trim().toLowerCase();
    const already = new Set(manifestPins);
    const matches = poolMembers.filter((m) => !already.has(m.id));
    if (!q) return matches.slice(0, 8);
    return matches
      .filter((m) => m.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [poolMembers, pinQuery, manifestPins]);

  const addPin = useCallback((id: string) => {
    setManifestPins((cur) => {
      if (cur.includes(id)) return cur;
      const size = Number(manifestSize || DEFAULT_MANIFEST_SIZE);
      if (cur.length >= size) return cur;
      return [...cur, id];
    });
    setPinQuery("");
  }, [manifestSize]);

  const removePin = useCallback((id: string) => {
    setManifestPins((cur) => cur.filter((p) => p !== id));
  }, []);

  const previewManifest = useCallback(async () => {
    if (!manifestPool) return;
    setPreviewBusy(true);
    setPreview(null);
    setPreviewError(null);
    try {
      // First save the pending config so the preview endpoint sees the
      // admin's live edits — the preview reads from getActiveDaily().
      const saveRes = await fetch("/api/admin/combine/daily", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeCode, config: payloadConfig() }),
      });
      if (!saveRes.ok) {
        const j = (await saveRes.json()) as { error?: string; message?: string };
        throw new Error(j.message ?? j.error ?? `save_failed_${saveRes.status}`);
      }
      const res = await fetch("/api/admin/combine/daily/preview-manifest");
      const j = (await res.json()) as ManifestPreview | ManifestPreviewError;
      if (!res.ok) {
        setPreviewError(j as ManifestPreviewError);
      } else {
        setPreview(j as ManifestPreview);
      }
    } catch (e) {
      setPreviewError({
        error: "preview_failed",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPreviewBusy(false);
    }
  }, [manifestPool, themeCode, payloadConfig]);

  const refreshSchedule = useCallback(async () => {
    const res = await fetch("/api/admin/combine/daily");
    if (!res.ok) return;
    const j = (await res.json()) as { schedule: ScheduleRow[] };
    setSchedule(j.schedule);
  }, []);

  // Fetch the active daily's resolved guest pool when the admin first
  // opens an Edit modal. Cached for the life of the page — the pool
  // only changes when the global config changes, and the admin can
  // reload the page after saving a new config.
  const ensureGuestPool = useCallback(async () => {
    if (guestPoolMembers !== null) return;
    try {
      const res = await fetch("/api/admin/combine/daily/guest-pool");
      if (!res.ok) throw new Error(`guest_pool_fetch_${res.status}`);
      const j = (await res.json()) as { items: PoolMember[] };
      setGuestPoolMembers(j.items);
    } catch (e) {
      setGuestPoolMembers([]);
      setMsg({
        text: e instanceof Error ? e.message : String(e),
        kind: "err",
      });
    }
  }, [guestPoolMembers]);

  const openEdit = useCallback(
    (row: ScheduleRow) => {
      void ensureGuestPool();
      setEditingDay(row);
    },
    [ensureGuestPool],
  );

  const { confirm, dialog: confirmDialog } = useConfirm();

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
    if (
      !(await confirm({
        title: "Regenerate schedule?",
        body: "Wipe days ≥ today and reroll the next 30 days.",
        confirmLabel: "Regenerate",
        destructive: true,
      }))
    )
      return;
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

  const resetToday = useCallback(
    async ({ wipeResults }: { wipeResults: boolean }) => {
      if (
        !(await confirm({
          title: "Reset today's daily?",
          body:
            "This invalidates every in-progress run save. Players currently in a run will lose their progress and need to start over.",
          confirmLabel: "Reset today",
          destructive: true,
        }))
      )
        return;
      if (wipeResults) {
        if (
          !(await confirm({
            title: "Also delete today's finished run records?",
            body: "This cannot be undone.",
            confirmLabel: "Delete results",
            destructive: true,
          }))
        )
          return;
      }
      const dayKey = todayKey();

      setBusy("reset");
      setMsg(null);
      try {
        const res = await fetch("/api/admin/combine/daily/reset-today", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmDay: dayKey, wipeResults }),
        });
        const j = (await res.json()) as {
          ok?: boolean;
          deletedResults?: number;
          error?: string;
          message?: string;
        };
        if (!res.ok || !j.ok) {
          throw new Error(j.message ?? j.error ?? `request_failed_${res.status}`);
        }
        const suffix = wipeResults ? ` Deleted ${j.deletedResults ?? 0} result(s).` : "";
        setMsg({ text: `Today's daily reset.${suffix}`, kind: "ok" });
        await refreshSchedule();
      } catch (e) {
        setMsg({ text: e instanceof Error ? e.message : String(e), kind: "err" });
        throw e; // rethrow so modal can surface it
      } finally {
        setBusy(null);
      }
    },
    [confirm, refreshSchedule],
  );

  const clearConfig = async () => {
    if (
      !(await confirm({
        title: "Clear daily config?",
        body: "Daily will still play on the chosen theme but with no cap or guests.",
        confirmLabel: "Clear",
        destructive: true,
      }))
    )
      return;
    setBusy("clear");
    setMsg(null);
    try {
      const res = await fetch("/api/admin/combine/daily", { method: "DELETE" });
      if (!res.ok) throw new Error(`request_failed_${res.status}`);
      setGuestPerRun("");
      setGuestMinBand("");
      setManifestPool("");
      setManifestSize(DEFAULT_MANIFEST_SIZE.toString());
      setManifestPartnerBias(DEFAULT_MANIFEST_PARTNER_BIAS.toString());
      setManifestPins([]);
      setPreview(null);
      setPreviewError(null);
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
          Which theme&apos;s recipes power today&apos;s daily. Endless and Fast are
          unaffected — they always use the player&apos;s chosen theme. Switching
          here is safe; players mid-run on today&apos;s daily keep the previous
          theme until the day rolls over (UTC midnight), or until you reset
          today&apos;s daily in the Danger zone below.
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
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Manifest</h3>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
          Players win by discovering every item on the per-day find list.
          Pick the pool (any combine theme), how big the list is, and
          optionally pin items that must always appear. The solver fills
          the rest and verifies the list is reachable from the daily
          seed before scheduling.
        </p>
        <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
          <Field
            label="Pool"
            hint={
              <>
                Combine theme whose membership defines the items available
                for the manifest. Blank = daily disabled (not recommended
                post-T-0240).
              </>
            }
          >
            <select
              value={manifestPool}
              onChange={(e) => {
                setManifestPool(e.target.value);
                setManifestPins([]); // reset pins when pool changes
                setPreview(null);
                setPreviewError(null);
              }}
              style={input}
            >
              <option value="">— disabled —</option>
              {themes.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label} ({t.code})
                </option>
              ))}
            </select>
          </Field>
          {manifestPool && (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <Field
                  label="Size"
                  hint={
                    <>
                      Items on the list. 1–12; 8 is the sweet spot, but on
                      broad pools (e.g. Everything) the current solver
                      handles 1–3 reliably — raise as the KB and solver
                      grow.
                    </>
                  }
                >
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={manifestSize}
                    onChange={(e) => setManifestSize(e.target.value)}
                    style={input}
                  />
                </Field>
                <Field
                  label="Partner bias"
                  hint={
                    <>
                      Dealer weight multiplier for tiles that are direct
                      partners of unfound manifest items. 0 disables; 0.3
                      is default.
                    </>
                  }
                >
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={manifestPartnerBias}
                    onChange={(e) => setManifestPartnerBias(e.target.value)}
                    style={input}
                  />
                </Field>
              </div>
              <Field
                label={`Pinned items (${manifestPins.length} / ${manifestSize || "?"})`}
                hint={
                  <>
                    Pins land on every day&apos;s list. The generator fills
                    the rest. Each pin must be reachable from the capped
                    bundle — unreachable pins reject on save + preview.
                  </>
                }
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginBottom: 6,
                  }}
                >
                  {manifestPins.map((id) => {
                    const name = itemNamesById[id] ?? id;
                    return (
                      <span
                        key={id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          border: "1px solid var(--ink)",
                          borderRadius: 10,
                          padding: "2px 4px 2px 10px",
                          fontSize: 12,
                        }}
                      >
                        {name}
                        <button
                          type="button"
                          aria-label={`Remove ${name}`}
                          onClick={() => removePin(id)}
                          style={{
                            width: 18,
                            height: 18,
                            lineHeight: "16px",
                            borderRadius: 9,
                            border: "1px solid var(--line)",
                            background: "var(--surface)",
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                  {manifestPins.length === 0 && (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      No pins yet.
                    </span>
                  )}
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    value={pinQuery}
                    onChange={(e) => setPinQuery(e.target.value)}
                    placeholder={
                      poolLoading
                        ? "Loading pool…"
                        : `Search ${poolMembers?.length ?? 0} items to pin…`
                    }
                    disabled={poolLoading}
                    style={input}
                  />
                  {pinQuery && pinSuggestions.length > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        marginTop: 4,
                        background: "var(--surface)",
                        border: "1px solid var(--ink)",
                        borderRadius: 3,
                        maxHeight: 220,
                        overflowY: "auto",
                        zIndex: 20,
                      }}
                    >
                      {pinSuggestions.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => addPin(m.id)}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "6px 10px",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontSize: 13,
                            color: "var(--ink)",
                          }}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
            </>
          )}
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
            {manifestPool && (
              <button
                type="button"
                className="btn"
                disabled={previewBusy || busy !== null}
                onClick={previewManifest}
                title="Save current config + preview today's manifest"
              >
                {previewBusy ? "…" : "Preview today's manifest"}
              </button>
            )}
            {msg && (
              <span style={{ fontSize: 12, color: msg.kind === "err" ? "#f85149" : "var(--good, #2a7a2a)", flexBasis: "100%" }}>
                {msg.text}
              </span>
            )}
          </div>
          {previewError && (
            <div
              style={{
                border: "1.5px solid #f85149",
                borderRadius: 3,
                padding: 10,
                background: "color-mix(in srgb, #f85149 10%, var(--surface))",
                fontSize: 13,
              }}
            >
              <strong>Preview failed:</strong> {previewError.message}
              {previewError.pin && (
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
                  Unreachable pin: <code>{itemNamesById[previewError.pin] ?? previewError.pin}</code>
                </div>
              )}
              {previewError.breakers && previewError.breakers.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                  <div style={{ marginBottom: 4 }}>
                    Last attempt&apos;s picks, with simulator turn-cost per item
                    (null = sim can&apos;t solve alone):
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {previewError.breakers.map((b) => (
                      <li key={b.id}>
                        {itemNamesById[b.id] ?? b.id}
                        <span style={{ marginLeft: 6, opacity: 0.7 }}>
                          — {b.difficulty === null ? "unsolvable" : `${b.difficulty} turns`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {(preview?.poolStats || previewError?.poolStats) && (
            <PoolHealth
              stats={(preview?.poolStats ?? previewError?.poolStats)!}
              itemNamesById={itemNamesById}
            />
          )}
          {preview && (
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 3,
                padding: 10,
                background: "var(--surface)",
                fontSize: 13,
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                Preview ({preview.day}) · pool {preview.poolSize} items ·
                simulator solved in <strong>{preview.turnsToSolve}</strong> turns
                {preview.sampler === "cluster" && preview.clusters && (
                  <>
                    {" "}
                    · <strong>{preview.clusters.length}</strong> cluster
                    {preview.clusters.length === 1 ? "" : "s"}
                  </>
                )}
              </div>
              {preview.pinned.length > 0 && (
                <div>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>PINNED </span>
                  {preview.pinned.map((id) => (
                    <span key={id} style={pillStyle}>
                      {itemNamesById[id] ?? id}
                    </span>
                  ))}
                </div>
              )}
              {preview.sampler === "cluster" && preview.clusters ? (
                <div style={{ display: "grid", gap: 6 }}>
                  {preview.clusters.map((c, i) => (
                    <div key={c.seed}>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        CLUSTER {i + 1} · seed {itemNamesById[c.seed] ?? c.seed}{" "}
                      </span>
                      {c.members.map((id) => (
                        <span key={id} style={pillStyle}>
                          {itemNamesById[id] ?? id}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>GENERATED </span>
                  {preview.generated.map((id) => (
                    <span key={id} style={pillStyle}>
                      {itemNamesById[id] ?? id}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="feat">
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Dealer tuning</h3>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
          Controls what&apos;s in the deal — how deep the recipe pool goes and
          what rare items drip in via guests. These don&apos;t change how long
          the run is (the target does that); they change what the player
          encounters along the way.
        </p>
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
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
              Each day, inject a deterministic set of harder-to-reach recipes into the dealer.
              Everyone sees the same guests; a rotation memory in the scheduler keeps a
              given item out for ~one full cycle before it can repeat. This is what lets
              players discover rare items from difficulty bands past the daily&apos;s cap.
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
                label="Min difficulty band"
                hint={
                  <>
                    Guests must live in this difficulty band or higher (1 = easiest to
                    discover, 14 = hardest on Everything today). The game auto-raises this
                    to at least &ldquo;cap + 1&rdquo; so guests never overlap the normal
                    daily progression.
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
              stay scheduled but won&apos;t surface in the game. Raise the difficulty cap
              or lower Guest min difficulty band to fix.
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
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span className="cb-seed">seed {r.payload.seed || "—"}</span>
                        {!r.isPast && (
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: "2px 8px", fontSize: 11 }}
                            onClick={() => openEdit(r)}
                          >
                            Edit
                          </button>
                        )}
                      </span>
                    </div>
                    {r.payload.manifest && r.payload.manifest.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>
                          MANIFEST ({r.payload.manifest.length})
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {r.payload.manifest.map((id) => (
                            <span key={id} style={pillStyle}>
                              {itemNamesById[id] ?? id}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {r.payload.guestOutputIds.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>
                          GUESTS
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {r.payload.guestOutputIds.map((id) => (
                            <span key={id} style={pillStyle}>
                              {itemNamesById[id] ?? id}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {(!r.payload.manifest || r.payload.manifest.length === 0) &&
                      r.payload.guestOutputIds.length === 0 && (
                        <span style={{ opacity: 0.5 }}>—</span>
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
                  <th style={th}>Manifest</th>
                  <th style={th}>Guests</th>
                  <th style={th}>Seed</th>
                  <th style={th}></th>
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
                            colSpan={5}
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
                          {!r.payload.manifest || r.payload.manifest.length === 0 ? (
                            <span style={{ opacity: 0.5 }}>—</span>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {r.payload.manifest.map((id) => (
                                <span key={id} style={pillStyle}>
                                  {itemNamesById[id] ?? id}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={td}>
                          {r.payload.guestOutputIds.length === 0 ? (
                            <span style={{ opacity: 0.5 }}>—</span>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {r.payload.guestOutputIds.map((id) => (
                                <span key={id} style={pillStyle}>
                                  {itemNamesById[id] ?? id}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, fontFamily: "var(--mono, monospace)", opacity: 0.7 }}>
                          {r.payload.seed || "—"}
                        </td>
                        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                          {!r.isPast && (
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: "2px 8px", fontSize: 11 }}
                              onClick={() => openEdit(r)}
                            >
                              Edit
                            </button>
                          )}
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

      {confirmDialog}
      {editingDay && (
        <EditDayModal
          day={editingDay.day}
          isToday={editingDay.day === todayKey()}
          currentPayload={editingDay.payload}
          itemNamesById={itemNamesById}
          guestPoolMembers={guestPoolMembers}
          manifestPoolMembers={poolMembers}
          configPins={initialActive?.config.manifest?.pins ?? []}
          onClose={() => setEditingDay(null)}
          onSaved={async () => {
            await refreshSchedule();
            setMsg({ text: `Updated ${editingDay.day}.`, kind: "ok" });
          }}
          onResetToday={resetToday}
        />
      )}
    </div>
  );
}

function PoolHealth({
  stats,
  itemNamesById,
}: {
  stats: PoolStatsPayload;
  itemNamesById: Record<string, string>;
}) {
  const [showUnsolvable, setShowUnsolvable] = useState(false);
  const warnColor = stats.unsolvable > 0 ? "var(--warn, #a66400)" : "var(--muted)";
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 3,
        padding: 10,
        background: "var(--surface)",
        fontSize: 12,
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        Pool health
      </div>
      <div>
        <strong>{stats.total}</strong> in pool ·{" "}
        <strong>{stats.reachable}</strong> reachable ·{" "}
        <strong>{stats.solvable}</strong> solvable by sim ·{" "}
        <span style={{ color: warnColor }}>
          <strong>{stats.unsolvable}</strong> unsolvable
        </span>
      </div>
      <div style={{ color: "var(--muted)" }}>
        Median solo-solve: <strong>{stats.medianDifficulty.toFixed(1)}</strong> turns
      </div>
      {stats.difficultyBuckets.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {stats.difficultyBuckets.map((b) => (
            <span
              key={b.range}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: "1px 8px",
                fontSize: 11,
                color: "var(--muted)",
              }}
            >
              {b.range}t · {b.count}
            </span>
          ))}
        </div>
      )}
      {stats.unsolvable > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowUnsolvable((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              fontSize: 11,
              color: "var(--warn, #a66400)",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {showUnsolvable ? "Hide" : "Show"} {stats.unsolvable} unsolvable item{stats.unsolvable === 1 ? "" : "s"}
          </button>
          {showUnsolvable && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {stats.unsolvableIds.map((id) => (
                <li key={id}>{itemNamesById[id] ?? id}</li>
              ))}
            </ul>
          )}
        </div>
      )}
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
const pillStyle: React.CSSProperties = {
  display: "inline-block",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "1px 8px",
  margin: "0 4px 4px 0",
  fontSize: 11,
};
