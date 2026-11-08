"use client";

import { useMemo, useState } from "react";
import type { CombineRunHistoryRow, CombineRunMode } from "@/lib/stats/runs";

const MODE_LABELS: Record<CombineRunMode, string> = {
  endless: "Endless",
  fast: "Fast",
  daily: "Daily",
  // Shouldn't surface — loader collapses "classic" to endless — but typed
  // in case a future mode lands.
  classic: "Classic",
};

export function RunHistoryList({
  runs,
  themeCodes,
}: {
  runs: CombineRunHistoryRow[];
  /** All theme codes present in `runs`, with their resolved labels, in the
   *  order they should appear in the filter chip row. */
  themeCodes: { code: string; label: string }[];
}) {
  const [mode, setMode] = useState<CombineRunMode | "all">("all");
  const [theme, setTheme] = useState<string | "all">("all");

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (mode !== "all" && r.mode !== mode) return false;
      if (theme !== "all" && r.theme !== theme) return false;
      return true;
    });
  }, [runs, mode, theme]);

  const modeChips: readonly (CombineRunMode | "all")[] = [
    "all",
    "endless",
    "fast",
    "daily",
  ];

  return (
    <>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <ChipGroup label="Mode">
          {modeChips.map((m) => (
            <Chip
              key={m}
              label={m === "all" ? "All" : MODE_LABELS[m]}
              active={mode === m}
              onClick={() => setMode(m)}
            />
          ))}
        </ChipGroup>

        {themeCodes.length > 1 && (
          <ChipGroup label="Theme">
            <Chip
              label="All"
              active={theme === "all"}
              onClick={() => setTheme("all")}
            />
            {themeCodes.map((t) => (
              <Chip
                key={t.code}
                label={t.label}
                active={theme === t.code}
                onClick={() => setTheme(t.code)}
              />
            ))}
          </ChipGroup>
        )}
      </div>

      {filtered.length === 0 ? (
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
          No runs match these filters.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 6,
          }}
        >
          {filtered.map((r) => (
            <li
              key={r.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                alignItems: "baseline",
                gap: 12,
                padding: "8px 12px",
                border: "1.5px solid var(--line)",
                borderRadius: 3,
                background: "var(--surface)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  gap: 8,
                  minWidth: 0,
                  fontSize: 14,
                }}
              >
                <b style={{ fontWeight: 700 }}>{r.themeLabel}</b>
                <ModeBadge mode={r.mode} />
                {r.daily && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      fontFamily:
                        "var(--mono, 'Chivo Mono'), ui-monospace, monospace",
                    }}
                  >
                    {r.daily}
                  </span>
                )}
                {typeof r.chapter === "number" && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                    }}
                  >
                    ch. {r.chapter}
                  </span>
                )}
              </span>
              <span
                style={{
                  fontFamily:
                    "var(--mono, 'Chivo Mono'), ui-monospace, monospace",
                  fontSize: 13,
                  color: "var(--muted)",
                  whiteSpace: "nowrap",
                  textAlign: "right",
                }}
              >
                <b style={{ color: "var(--ink)", fontWeight: 700 }}>
                  {r.score.toLocaleString()}
                </b>{" "}
                · {r.made} made · {fmtDate(r.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ChipGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        border: `1.5px solid ${active ? "var(--ink)" : "var(--line)"}`,
        background: active ? "var(--ink)" : "transparent",
        color: active ? "var(--surface)" : "var(--ink)",
        borderRadius: 3,
        padding: "4px 10px",
        fontSize: 12,
        fontFamily: "inherit",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function ModeBadge({ mode }: { mode: CombineRunMode }) {
  return (
    <span
      style={{
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--muted)",
        border: "1px solid var(--line)",
        borderRadius: 2,
        padding: "1px 6px",
      }}
    >
      {MODE_LABELS[mode]}
    </span>
  );
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
