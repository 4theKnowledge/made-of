import React from "react";
import type { GameState } from "@/combine/engine";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { CombineTile } from "@/components/combine/board-parts/CombineTile";

export function Tray({
  state,
  bundle,
  selected,
  onSlotTap,
  onSlotPointerDown,
}: {
  state: GameState;
  bundle: ThemeBundle;
  selected: { source: "tray" | "hold"; slot: number } | null;
  onSlotTap: (source: "tray" | "hold", slot: number) => void;
  onSlotPointerDown: (
    slot: number,
    source: "tray" | "hold",
    e: React.PointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  const isSel = (slot: number) =>
    selected?.source === "tray" && selected.slot === slot;
  return (
    <div className="cbtray" aria-label="Tray">
      {state.tray.map((id, slot) => {
        if (id == null) {
          return (
            <div key={slot} className="cbp empty" aria-hidden="true" />
          );
        }
        const item = bundle.items.get(id);
        if (!item) return <div key={slot} className="cbp empty" />;
        const sel = isSel(slot);
        const isTool = bundle.tools.has(id);
        return (
          <CombineTile
            key={slot}
            variant="tray"
            item={item}
            label
            className={sel ? "sel" : undefined}
            data-cbp={slot}
            onPointerDown={(e) => onSlotPointerDown(slot, "tray", e)}
            onClick={() => onSlotTap("tray", slot)}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={`Tray slot ${slot + 1}: ${cap(item.name)}${sel ? ", selected" : ""}`}
            aria-pressed={sel}
          >
            {isTool && <span className="tool">tool</span>}
          </CombineTile>
        );
      })}
    </div>
  );
}
