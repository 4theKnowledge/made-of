"use client";

/**
 * The audit grid as a client component. Clicking any tile opens the
 * PictogramEditor side-sheet. Successful saves update local state in
 * place so no page refresh is needed; a server-side reloadSnapshot()
 * fires on next request through the live snapshot cycle.
 */

import { useMemo, useState } from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { ItemKind, Tier } from "@/db/schema";
import { PictogramEditor } from "./PictogramEditor";

export interface AuditItem {
  id: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  symbol: string | null;
  pictogram: string | null;
  /** Pre-resolved SVG (item's own if set, else the kind fallback). Passing
   *  this to <Pictogram pictogram={...}> keeps the tile sync-rendered and
   *  avoids the client-side useEffect fetch. */
  effectivePictogram: string | null;
}

export interface AuditKind {
  code: string;
  label: string;
  pictogram: string | null;
}

interface Props {
  itemsByKind: Record<string, AuditItem[]>;
  kinds: AuditKind[];
}

export function PictogramAuditClient({ itemsByKind, kinds }: Props) {
  // Local mutable copy so saves reflect immediately.
  const [items, setItems] = useState(itemsByKind);
  const [kindRows, setKindRows] = useState(kinds);
  const [editing, setEditing] = useState<
    | { kind: "item"; item: AuditItem }
    | { kind: "kind"; kindCode: string; kindLabel: string; initial: string | null }
    | null
  >(null);

  const kindOrder = useMemo(() => kindRows.map((k) => k.code), [kindRows]);

  function updateItem(itemId: string, pictogram: string | null) {
    setItems((prev) => {
      const next: typeof prev = {};
      for (const [kind, list] of Object.entries(prev)) {
        const kindFallback =
          kindRows.find((k) => k.code === kind)?.pictogram ?? null;
        next[kind] = list.map((it) =>
          it.id === itemId
            ? { ...it, pictogram, effectivePictogram: pictogram ?? kindFallback }
            : it,
        );
      }
      return next;
    });
  }

  function updateKind(code: string, pictogram: string | null) {
    setKindRows((prev) => prev.map((k) => (k.code === code ? { ...k, pictogram } : k)));
    // Items in this kind that don't carry their own pictogram take the
    // new fallback; items with their own pictogram are unaffected.
    setItems((prev) => {
      const list = prev[code];
      if (!list) return prev;
      return {
        ...prev,
        [code]: list.map((it) =>
          it.pictogram ? it : { ...it, effectivePictogram: pictogram },
        ),
      };
    });
  }

  return (
    <>
      {kindOrder.map((code) => {
        const kindRow = kindRows.find((k) => k.code === code);
        if (!kindRow) return null;
        const list = items[code] ?? [];
        const specifics = list.filter((i) => i.pictogram || i.symbol);
        const fallbacks = list.filter((i) => !i.pictogram && !i.symbol);
        return (
          <section className="feat" key={code} style={{ marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginTop: 0,
                marginBottom: 12,
                gap: 10,
              }}
            >
              <h3 style={{ margin: 0 }}>
                {kindRow.label}{" "}
                <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 14 }}>
                  ({list.length} items — {specifics.length} specific, {fallbacks.length} fallback)
                </span>
              </h3>
              <button
                className="btn"
                onClick={() =>
                  setEditing({
                    kind: "kind",
                    kindCode: kindRow.code,
                    kindLabel: kindRow.label,
                    initial: kindRow.pictogram,
                  })
                }
                title="Edit this kind's fallback pictogram"
              >
                Edit fallback
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                gap: 12,
              }}
            >
              {list.map((item) => {
                const isFallback = !item.pictogram && !item.symbol;
                return (
                  <button
                    key={item.id}
                    onClick={() => setEditing({ kind: "item", item })}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: 8,
                      borderRadius: 6,
                      border: isFallback ? "1px dashed var(--muted)" : "1px solid var(--line, rgba(0,0,0,0.08))",
                      background: isFallback ? "rgba(0,0,0,0.02)" : "transparent",
                      cursor: "pointer",
                      font: "inherit",
                      color: "inherit",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ transform: "scale(2.2)", transformOrigin: "center", margin: "16px 0 20px" }}>
                      <Pictogram
                        name={item.name}
                        tier={item.tier}
                        kind={item.kind}
                        symbol={item.symbol}
                        pictogram={item.effectivePictogram}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        wordBreak: "break-word",
                        lineHeight: 1.2,
                      }}
                    >
                      {item.name}
                    </div>
                    {isFallback && (
                      <div style={{ fontSize: 9, color: "var(--muted)" }}>fallback</div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {editing && editing.kind === "item" && (
        <PictogramEditor
          target={{
            kind: "item",
            itemId: editing.item.id,
            itemName: editing.item.name,
            itemKind: editing.item.kind,
            tier: editing.item.tier,
            symbol: editing.item.symbol,
            initial: editing.item.pictogram,
          }}
          onClose={() => setEditing(null)}
          onSaved={(next) => updateItem(editing.item.id, next)}
        />
      )}
      {editing && editing.kind === "kind" && (
        <PictogramEditor
          target={{
            kind: "kind",
            kindCode: editing.kindCode,
            initial: editing.initial,
          }}
          onClose={() => setEditing(null)}
          onSaved={(next) => updateKind(editing.kindCode, next)}
        />
      )}
    </>
  );
}
