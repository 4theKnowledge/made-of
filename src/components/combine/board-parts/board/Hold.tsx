import React, { useEffect, useRef, useState } from "react";
import type { GameState } from "@/combine/engine";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { CombineTile } from "@/components/combine/board-parts/CombineTile";

export function Hold({
  state,
  bundle,
  active,
  activeOk,
  dragging,
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
  /** True whenever ANY drag is in progress. Used to hide the sticky
   *  tally chip so it doesn't obstruct the drop target visually. */
  dragging: boolean;
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
  const heldCount = state.hold.reduce((n, v) => n + (v == null ? 0 : 1), 0);
  const hasRoom = state.hold.some((v) => v == null);
  const tapReady = selected?.source === "tray" && hasRoom;
  const isSel = (slot: number) =>
    selected?.source === "hold" && selected.slot === slot;
  const holdRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });
  useEffect(() => {
    const el = holdRef.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setOverflow((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [state.hold.length]);
  const classes = ["cbshelf", "cbhold"];
  if (empty) classes.push("none");
  if (active) classes.push(activeOk ? "over" : "over-bad");
  if (tapReady) classes.push("tap-ready");
  if (dragging) classes.push("dragging");
  if (overflow.left) classes.push("ov-l");
  if (overflow.right) classes.push("ov-r");
  return (
    <div
      ref={holdRef}
      className={classes.join(" ")}
      data-cbholdzone="1"
      aria-label="Hold — drag or tap a tile here to save for later. Held tiles crumble when the age moves past them."
      onClick={(e) => {
        if (selected?.source !== "tray") return;
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
      <span className="cbshelf-empty cbshelf-tally" aria-hidden="true">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 3h12v18l-6-4-6 4z" />
        </svg>
        {empty ? <em>Hold</em> : <em>{heldCount} held</em>}
      </span>
    </div>
  );
}
