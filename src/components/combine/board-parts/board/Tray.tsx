import React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { GameState } from "@/combine/engine";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";

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
        const classes = ["cbp"];
        if (isSel(slot)) classes.push("sel");
        const isTool = bundle.tools.has(id);
        return (
          <button
            key={slot}
            type="button"
            className={classes.join(" ")}
            data-cbp={slot}
            style={fillVar(item)}
            onPointerDown={(e) => onSlotPointerDown(slot, "tray", e)}
            onClick={() => onSlotTap("tray", slot)}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={`Tray slot ${slot + 1}: ${cap(item.name)}${isSel(slot) ? ", selected" : ""}`}
            aria-pressed={isSel(slot)}
          >
            {isTool && <span className="tool">tool</span>}
            <Pictogram
              name={item.name}
              tier={item.tier}
              kind={item.kind}
              symbol={item.symbol}
            />
            <span className="cbn">{cap(item.name)}</span>
          </button>
        );
      })}
    </div>
  );
}
