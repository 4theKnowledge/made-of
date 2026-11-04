/**
 * Admin-only testing panel for Combine.
 *
 * Toggles debug mode, deals arbitrary tiles into tray slots, jumps between
 * ages. All actions go through the normal engine reducer — this component
 * only dispatches. Mounted by CombineBoard when the server-side admin check
 * passed; nothing here is a security boundary.
 */
"use client";

import { useMemo, useState } from "react";
import type { GameState, Action } from "@/combine/engine";
import type { ThemeBundle } from "@/combine/types";
import { catalogueByKind } from "@/combine/data";

interface Props {
  state: GameState;
  bundle: ThemeBundle;
  dispatch: (action: Action) => void;
  onClose: () => void;
  /** Forces the "last chance" preview on regardless of the live predicate —
   *  dialog fires on toggle, board border adopts the dashed-red treatment.
   *  Admin-only; lets us demo the end-to-end UX in context. */
  previewLastChance: boolean;
  onPreviewLastChanceToggle: () => void;
  /** Current value of the derived predicate, surfaced for at-a-glance
   *  debugging regardless of the preview toggle. */
  lastChance: boolean;
}

export function CombineDebugPanel({
  state,
  bundle,
  dispatch,
  onClose,
  previewLastChance,
  onPreviewLastChanceToggle,
  lastChance,
}: Props) {
  const [query, setQuery] = useState("");
  const [slot, setSlot] = useState(0);
  const cat = useMemo(() => catalogueByKind(bundle), [bundle]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const out: { id: string; name: string; kind: string }[] = [];
    for (const { kind, items } of cat.kinds) {
      for (const id of items) {
        const item = bundle.items.get(id);
        if (!item) continue;
        if (q && !item.name.toLowerCase().includes(q)) continue;
        out.push({ id, name: item.name, kind });
        if (out.length >= 80) break;
      }
      if (out.length >= 80) break;
    }
    return out;
  }, [cat, bundle.items, q]);

  const ages = bundle.theme.ages;

  return (
    <div className="cbdebug" role="dialog" aria-label="Combine debug panel">
      <div className="cbdebug-top">
        <strong>Debug</strong>
        <span className={state.debug ? "cbdebug-on" : "cbdebug-off"}>
          {state.debug ? "ON" : "OFF"}
        </span>
        <button
          type="button"
          className="cbdebug-btn"
          onClick={() => dispatch({ type: "debug-toggle" })}
        >
          {state.debug ? "turn off" : "turn on"}
        </button>
        <button
          type="button"
          className="cbdebug-btn cbdebug-x"
          onClick={onClose}
          aria-label="Close debug panel"
        >
          ×
        </button>
      </div>

      {state.debug && (
        <p className="cbdebug-note">
          Helpers are free. This run won&apos;t save or overwrite your real
          endless save.
        </p>
      )}

      <section className="cbdebug-sec">
        <h4>Board state</h4>
        <div className="cbdebug-ages">
          <button
            type="button"
            className={
              "cbdebug-btn" + (state.over ? " cbdebug-btn-on" : "")
            }
            disabled={!state.debug}
            onClick={() => dispatch({ type: "debug-toggle-over" })}
          >
            {state.over ? "unlock board" : "lock board (game over)"}
          </button>
        </div>
      </section>

      <section className="cbdebug-sec">
        <h4>Last chance preview</h4>
        <div className="cbdebug-ages">
          <span className={lastChance ? "cbdebug-on" : "cbdebug-off"}>
            live: {lastChance ? "active" : "inactive"}
          </span>
          <button
            type="button"
            className={
              "cbdebug-btn" + (previewLastChance ? " cbdebug-btn-on" : "")
            }
            onClick={onPreviewLastChanceToggle}
          >
            {previewLastChance ? "turn off" : "force on"}
          </button>
        </div>
      </section>

      <section className="cbdebug-sec">
        <h4>Jump to age</h4>
        <div className="cbdebug-ages">
          {ages.map((label, i) => (
            <button
              key={label + i}
              type="button"
              className={
                "cbdebug-btn" + (state.age === i ? " cbdebug-btn-on" : "")
              }
              disabled={!state.debug}
              onClick={() => dispatch({ type: "debug-set-age", age: i })}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="cbdebug-sec">
        <h4>Deal tile to tray</h4>
        <div className="cbdebug-slots">
          {state.tray.map((_, i) => (
            <button
              key={i}
              type="button"
              className={
                "cbdebug-btn" + (slot === i ? " cbdebug-btn-on" : "")
              }
              onClick={() => setSlot(i)}
            >
              slot {i + 1}
            </button>
          ))}
        </div>
        <input
          className="cbdebug-input"
          type="search"
          placeholder="search items…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!state.debug}
        />
        <ul className="cbdebug-list">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="cbdebug-tile"
                disabled={!state.debug}
                onClick={() =>
                  dispatch({ type: "debug-deal", slot, tile: m.id })
                }
                title={`${m.name} (${m.kind})`}
              >
                <span className="cbdebug-tilename">{m.name}</span>
                <span className="cbdebug-tilekind">{m.kind}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="cbdebug-empty">no matches</li>
          )}
        </ul>
      </section>
    </div>
  );
}
