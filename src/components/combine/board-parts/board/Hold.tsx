import React from "react";
import type { GameState } from "@/combine/engine";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { CombineTile } from "@/components/combine/board-parts/CombineTile";

export function Hold({
  state,
  bundle,
  active,
  activeOk,
  selected,
  onSlotTap,
  onSlotPointerDown,
  onHoldTap,
}: {
  state: GameState;
  bundle: ThemeBundle;
  /** True while a tray tile is being dragged and the pointer is over the
   *  zone — tells CSS to highlight the drop target. */
  active: boolean;
  /** True iff `active` and the drop would succeed (zone has room). When
   *  active but not ok, the zone paints a reject state. */
  activeOk: boolean;
  /** Currently selected slot (tap-to-select), if any. A tray selection
   *  tapped on the zone stashes the tile; a hold selection shows the
   *  held tile as active so it can be placed on a board cell. */
  selected: { source: "tray" | "hold"; slot: number } | null;
  onSlotTap: (source: "tray" | "hold", slot: number) => void;
  onSlotPointerDown: (
    slot: number,
    source: "tray" | "hold",
    e: React.PointerEvent<HTMLButtonElement>,
  ) => void;
  onHoldTap: () => void;
}) {
  const empty = state.hold.every((v) => v == null);
  const hasRoom = state.hold.some((v) => v == null);
  const tapReady = selected?.source === "tray" && hasRoom;
  const isSel = (slot: number) =>
    selected?.source === "hold" && selected.slot === slot;
  const classes = ["cbshelf", "cbhold"];
  if (empty) classes.push("none");
  if (active) classes.push(activeOk ? "over" : "over-bad");
  if (tapReady) classes.push("tap-ready");
  return (
    <div
      className={classes.join(" ")}
      data-cbholdzone="1"
      aria-label="Hold — drag or tap a tile here to save for later. Held tiles crumble when the age moves past them."
      onClick={(e) => {
        if (selected?.source !== "tray") return;
        // Ignore clicks that originated on a held-tile button; those have
        // their own tap behaviour (select/drag).
        if ((e.target as HTMLElement).closest(".cbheld")) return;
        onHoldTap();
      }}
    >
      <span className="cbshelf-slots">
        {state.hold.map((id, slot) => {
          if (id == null) {
            return (
              <span
                key={`ph-${slot}`}
                className="cbslot cbslot-ph"
                aria-hidden="true"
              />
            );
          }
          const item = bundle.items.get(id);
          if (!item) return null;
          const sel = isSel(slot);
          const extra = sel ? "cbheld sel" : "cbheld";
          return (
            <CombineTile
              key={slot}
              variant="slot"
              item={item}
              className={extra}
              onPointerDown={(e) => onSlotPointerDown(slot, "hold", e)}
              onClick={() => onSlotTap("hold", slot)}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={`Held: ${cap(item.name)}${sel ? ", selected" : ""}`}
              aria-pressed={sel}
            />
          );
        })}
      </span>
      <span className="cbshelf-empty" aria-hidden="true">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 3h12v18l-6-4-6 4z" />
        </svg>
        <em>Hold zone</em>
      </span>
    </div>
  );
}
