"use client";

/**
 * Click-to-edit overlay for pictograms. Mounted by the audit page beside
 * every tile; clicking opens a side panel with a textarea, live preview,
 * and sanitiser feedback. Save PATCHes the item or kind, closes, and asks
 * the parent to reload.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pictogram } from "@/pictograms/Pictogram";
import type { ItemKind, Tier } from "@/db/schema";

type Target =
  | {
      kind: "item";
      itemId: string;
      itemName: string;
      itemKind: ItemKind;
      tier: Tier;
      symbol: string | null;
      initial: string | null;
    }
  | {
      kind: "kind";
      kindCode: string;
      initial: string | null;
    };

interface Props {
  target: Target;
  onClose: () => void;
  onSaved: (next: string | null) => void;
}

export function PictogramEditor({ target, onClose, onSaved }: Props) {
  const [value, setValue] = useState(target.initial ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Live-ish sanity check: run the sanitiser's quick regex locally so the
  // admin sees red while they type. The server runs the authoritative pass
  // on save, so we don't need to be exhaustive here.
  useEffect(() => {
    const quickErrors: string[] = [];
    if (/<\s*(script|style|foreignObject|iframe|image|use)\b/i.test(value)) {
      quickErrors.push("Contains a disallowed element.");
    }
    if (/\son[a-z]+\s*=/i.test(value)) {
      quickErrors.push("Contains an event handler attribute.");
    }
    setErrors(quickErrors);
  }, [value]);

  async function save() {
    setSaving(true);
    setApiError(null);
    try {
      const body = { pictogram: value.trim() === "" ? null : value };
      const url =
        target.kind === "item"
          ? `/api/admin/items/${target.itemId}`
          : `/api/admin/kinds/${encodeURIComponent(target.kindCode)}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        error?: string;
        details?: string[];
        item?: { pictogram: string | null };
        kind?: { pictogram: string | null };
      };
      if (!res.ok) {
        if (data.details?.length) setErrors(data.details);
        else setApiError(data.error ?? "save_failed");
        return;
      }
      const saved = data.item?.pictogram ?? data.kind?.pictogram ?? null;
      // Rebuild the live snapshot so other pages pick up the change
      // without waiting for a redeploy or natural eviction. Fire and
      // forget — the save itself has already succeeded.
      void fetch("/api/admin/snapshot/reload", { method: "POST" });
      onSaved(saved);
      onClose();
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  const label =
    target.kind === "item"
      ? target.itemName
      : `kind: ${target.kindCode}`;

  return createPortal(
    <div
      role="dialog"
      aria-label={`Edit pictogram for ${label}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          background: "var(--bg, #fff)",
          padding: 20,
          overflowY: "auto",
          borderLeft: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Pictogram — {label}</h3>
          <button className="btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div style={{ display: "flex", gap: 20, alignItems: "center", marginBottom: 14 }}>
          <div style={{ transform: "scale(2.2)", transformOrigin: "left center", width: 32 }}>
            {target.kind === "item" ? (
              <Pictogram
                name={target.itemName}
                tier={target.tier}
                kind={target.itemKind}
                symbol={target.symbol}
                pictogram={value}
              />
            ) : (
              // For a kind preview, synthesise a bare tile at tier N using
              // the typed value. Not quite the real fallback (which only
              // kicks in when an item has no symbol and no override), but
              // this is the best lossless preview of just the SVG string.
              <Pictogram
                name="__preview__"
                tier="N"
                kind={target.kindCode as ItemKind}
                symbol={null}
                pictogram={value}
              />
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Live preview — the tile fill is tier-based; the SVG is your markup.
          </div>
        </div>

        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={14}
          placeholder='<circle class="b" cx="16" cy="16" r="6"/><path class="l" d="M3 3h26"/>'
          style={{
            width: "100%",
            fontFamily: "var(--mono, monospace)",
            fontSize: 12,
            padding: 10,
            border: "1px solid var(--line)",
            borderRadius: 4,
          }}
          autoFocus
        />
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 10px" }}>
          32×32 viewBox. Allowed elements: path, circle, ellipse, rect, line, polyline, polygon, g.
          Allowed classes: b (body), l (line), k (ink fill), w (white line).
        </p>

        {errors.length > 0 && (
          <ul style={{ color: "var(--bad, #a62828)", fontSize: 13, margin: "0 0 10px 20px" }}>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        {apiError && (
          <p style={{ color: "var(--bad, #a62828)", fontSize: 13 }}>Error: {apiError}</p>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={() => {
              setValue("");
            }}
            disabled={saving || value === ""}
            title="Clear this override — item will fall back to its kind's pictogram"
          >
            Clear override
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? "…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
