"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { DailyPayload } from "@/combine/daily-schedule";

interface PoolMember {
  id: string;
  name: string;
}

interface SaveResponse {
  ok?: boolean;
  payload?: DailyPayload;
  unresolvedGuests?: string[];
  turnsToSolve?: number | null;
  error?: string;
  message?: string;
  invalid?: string[];
  pin?: string;
  manifest?: string[];
}

/** Edit a single scheduled day's guests + extra pins. Future days only.
 *  The modal saves via `PUT /api/admin/combine/daily/[day]`, which
 *  re-runs the solver to produce a fresh manifest from the merged
 *  pin set.
 *
 *  `manifestPoolMembers` and `guestPoolMembers` are passed in from the
 *  parent so this component doesn't re-fetch on every open. `null`
 *  for either means the pool isn't loaded yet (empty typeahead). */
export function EditDayModal({
  day,
  isToday,
  currentPayload,
  itemNamesById,
  guestPoolMembers,
  manifestPoolMembers,
  configPins,
  onClose,
  onSaved,
  onResetToday,
}: {
  day: string;
  isToday: boolean;
  currentPayload: DailyPayload;
  itemNamesById: Record<string, string>;
  guestPoolMembers: PoolMember[] | null;
  manifestPoolMembers: PoolMember[] | null;
  configPins: string[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  /** Fire the full today-reroll. The parent owns the confirm flow +
   *  wipeResults state since both predate this modal. Only wired when
   *  `isToday` — ignored otherwise. */
  onResetToday?: (opts: { wipeResults: boolean }) => Promise<void>;
}) {
  const [guests, setGuests] = useState<string[]>(
    currentPayload.guestOutputIds.slice(),
  );
  // Extra pins are pins the admin is adding to this day only — on top of
  // the globally-configured pins (which stay in configPins, shown but not
  // editable here).
  const existingExtras = useMemo(() => {
    const configSet = new Set(configPins);
    return (currentPayload.config?.manifest?.pins ?? []).filter(
      (p) => !configSet.has(p),
    );
  }, [currentPayload, configPins]);
  const [extraPins, setExtraPins] = useState<string[]>(existingExtras);

  const [guestQuery, setGuestQuery] = useState("");
  const [pinQuery, setPinQuery] = useState("");
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wipeResults, setWipeResults] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const guestSuggestions = useMemo<PoolMember[]>(() => {
    if (!guestPoolMembers) return [];
    const already = new Set(guests);
    const q = guestQuery.trim().toLowerCase();
    const matches = guestPoolMembers.filter((m) => !already.has(m.id));
    if (!q) return matches.slice(0, 8);
    return matches.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [guestPoolMembers, guests, guestQuery]);

  const pinSuggestions = useMemo<PoolMember[]>(() => {
    if (!manifestPoolMembers) return [];
    const already = new Set([...configPins, ...extraPins]);
    const q = pinQuery.trim().toLowerCase();
    const matches = manifestPoolMembers.filter((m) => !already.has(m.id));
    if (!q) return matches.slice(0, 8);
    return matches.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [manifestPoolMembers, configPins, extraPins, pinQuery]);

  const addGuest = useCallback((id: string) => {
    setGuests((cur) => (cur.includes(id) ? cur : [...cur, id]));
    setGuestQuery("");
  }, []);
  const removeGuest = useCallback((id: string) => {
    setGuests((cur) => cur.filter((g) => g !== id));
  }, []);
  const addExtraPin = useCallback((id: string) => {
    setExtraPins((cur) => (cur.includes(id) ? cur : [...cur, id]));
    setPinQuery("");
  }, []);
  const removeExtraPin = useCallback((id: string) => {
    setExtraPins((cur) => cur.filter((p) => p !== id));
  }, []);

  const save = async () => {
    setBusy("save");
    setErr(null);
    try {
      const res = await fetch(
        `/api/admin/combine/daily/${encodeURIComponent(day)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            guestOutputIds: guests,
            extraPins,
          }),
        },
      );
      const j = (await res.json()) as SaveResponse;
      if (!res.ok || !j.ok) {
        const parts: string[] = [];
        parts.push(j.message ?? j.error ?? `request_failed_${res.status}`);
        if (j.invalid?.length) {
          parts.push(
            `Invalid: ${j.invalid.map((i) => itemNamesById[i] ?? i).join(", ")}`,
          );
        }
        if (j.pin) {
          parts.push(`Pin: ${itemNamesById[j.pin] ?? j.pin}`);
        }
        throw new Error(parts.join(" · "));
      }
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="cbscrim" onClick={onClose} aria-hidden="true" />
      <section
        className="cbover tree-root-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit daily for ${day}`}
        style={{
          maxWidth: 560,
          width: "min(92vw, 560px)",
          textAlign: "left",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 18 }}>Edit daily · {day}</h3>
          <span
            style={{
              fontSize: 11,
              color: "var(--muted)",
              fontFamily: "var(--mono, monospace)",
            }}
          >
            seed {currentPayload.seed || "—"}
          </span>
        </div>

        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
          Tweak guests or add extra pins for this day only. The solver reruns
          to rebuild the manifest on save. Seed stays stable so the board
          layout stays deterministic.
        </p>
        {isToday && (
          <div
            style={{
              border: "1.5px solid var(--warn, #a66400)",
              background: "color-mix(in srgb, #a66400 10%, var(--surface))",
              borderRadius: 3,
              padding: 10,
              fontSize: 12,
              color: "var(--ink)",
              marginBottom: 10,
            }}
          >
            <strong style={{ color: "var(--warn, #a66400)" }}>
              Editing today&apos;s row.
            </strong>{" "}
            Save tweaks guests + pins but keeps the seed, so players already
            mid-run stay on their current board until they refresh. For a full
            reroll that invalidates in-flight saves, use the Danger zone at
            the bottom.
          </div>
        )}

        <div style={{ display: "grid", gap: 14 }}>
          <Section
            label={`Guests (${guests.length})`}
            hint="Guest ingredients injected into the dealer for this day. Must come from the active config's guest pool."
          >
            <ChipList
              ids={guests}
              itemNamesById={itemNamesById}
              onRemove={removeGuest}
              emptyText="No guests."
            />
            <Typeahead
              query={guestQuery}
              onQuery={setGuestQuery}
              suggestions={guestSuggestions}
              onPick={addGuest}
              placeholder={
                guestPoolMembers == null
                  ? "Loading guest pool…"
                  : `Search ${guestPoolMembers.length} guest candidates…`
              }
              disabled={guestPoolMembers == null}
            />
          </Section>

          <Section
            label={`Extra pins for this day (${extraPins.length})`}
            hint="Items that must appear on this day's manifest, on top of the globally-pinned items."
          >
            {configPins.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 4,
                  }}
                >
                  Config pins (read-only)
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {configPins.map((id) => (
                    <span key={id} style={{ ...pillStyle, opacity: 0.7 }}>
                      {itemNamesById[id] ?? id}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <ChipList
              ids={extraPins}
              itemNamesById={itemNamesById}
              onRemove={removeExtraPin}
              emptyText="No extra pins for this day."
            />
            <Typeahead
              query={pinQuery}
              onQuery={setPinQuery}
              suggestions={pinSuggestions}
              onPick={addExtraPin}
              placeholder={
                manifestPoolMembers == null
                  ? "Loading manifest pool…"
                  : `Search ${manifestPoolMembers.length} items to pin…`
              }
              disabled={manifestPoolMembers == null}
            />
          </Section>

          {currentPayload.manifest.length > 0 && (
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                borderTop: "1px dashed var(--line)",
                paddingTop: 10,
              }}
            >
              <div style={{ marginBottom: 4 }}>
                Current manifest ({currentPayload.manifest.length}) — will be
                recomputed on save:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {currentPayload.manifest.map((id) => (
                  <span key={id} style={pillStyle}>
                    {itemNamesById[id] ?? id}
                  </span>
                ))}
              </div>
            </div>
          )}

          {err && (
            <div
              style={{
                border: "1.5px solid #f85149",
                borderRadius: 3,
                padding: 10,
                background: "color-mix(in srgb, #f85149 10%, var(--surface))",
                fontSize: 13,
                color: "var(--ink)",
              }}
            >
              {err}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={busy !== null}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={save}
            disabled={busy !== null}
          >
            {busy === "save" ? "…" : "Save"}
          </button>
        </div>

        {isToday && onResetToday && (
          <div
            style={{
              marginTop: 20,
              paddingTop: 14,
              borderTop: "1px solid var(--line)",
              display: "grid",
              gap: 10,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--warn, #a66400)",
              }}
            >
              Danger zone
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              Reroll today&apos;s daily from scratch (new seed, new manifest,
              new guests). Every in-progress run save is invalidated — players
              mid-run lose their board on refresh and start over. Collection
              discoveries are kept (they&apos;re lifetime).
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "var(--ink)",
              }}
            >
              <input
                type="checkbox"
                checked={wipeResults}
                onChange={(e) => setWipeResults(e.target.checked)}
                disabled={busy !== null}
              />
              Also delete today&apos;s finished player results
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                (clears today&apos;s leaderboard)
              </span>
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn danger"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy("reset");
                  setErr(null);
                  try {
                    await onResetToday({ wipeResults });
                    onClose();
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === "reset" ? "…" : "Reset today's daily"}
              </button>
            </div>
          </div>
        )}
      </section>
    </>,
    document.body,
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
          {hint}
        </div>
      )}
      {children}
    </div>
  );
}

function ChipList({
  ids,
  itemNamesById,
  onRemove,
  emptyText,
}: {
  ids: string[];
  itemNamesById: Record<string, string>;
  onRemove: (id: string) => void;
  emptyText: string;
}) {
  if (ids.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{emptyText}</div>
    );
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {ids.map((id) => {
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
              onClick={() => onRemove(id)}
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
    </div>
  );
}

function Typeahead({
  query,
  onQuery,
  suggestions,
  onPick,
  placeholder,
  disabled,
}: {
  query: string;
  onQuery: (q: string) => void;
  suggestions: PoolMember[];
  onPick: (id: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={inputStyle}
      />
      {query && suggestions.length > 0 && (
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
          {suggestions.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onPick(m.id)}
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
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid var(--line)",
  borderRadius: 3,
  background: "var(--card)",
  color: "var(--ink)",
  width: "100%",
  boxSizing: "border-box",
};

const pillStyle: React.CSSProperties = {
  display: "inline-block",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "1px 8px",
  margin: "0 4px 4px 0",
  fontSize: 11,
};
