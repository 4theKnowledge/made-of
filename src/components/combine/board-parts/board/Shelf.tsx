import React, { useEffect, useRef, useState } from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { GameState } from "@/combine/engine";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import type { Fx } from "@/components/combine/board-parts/types";
import { fillVar } from "@/components/combine/board-parts/util";

export function Shelf({
  state,
  bundle,
  fx,
  onInfo,
}: {
  state: GameState;
  bundle: ThemeBundle;
  fx: Fx;
  onInfo: (id: string) => void;
}) {
  // Group by output id with a count badge.
  const counts = new Map<string, number>();
  for (const id of state.shelf) counts.set(id, (counts.get(id) ?? 0) + 1);
  const empty = counts.size === 0;
  // The id that just landed on the shelf, so it gets .new.
  const freshlyShipped = fx.shipped
    ? state.shelf[state.shelf.length - 1]
    : null;
  const shelfRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });
  useEffect(() => {
    const el = shelfRef.current;
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
  }, [state.shelf.length]);
  return (
    <div
      ref={shelfRef}
      className={`cbshelf${empty ? " none" : ""}${overflow.left ? " ov-l" : ""}${overflow.right ? " ov-r" : ""}`}
      aria-label={`Made and shipped: ${state.shelf.length}`}
    >
      <span className="cbshelf-slots">
        {[...counts.entries()].map(([id, n]) => {
          const item = bundle.items.get(id);
          if (!item) return null;
          const isNew = id === freshlyShipped;
          return (
            <button
              key={id}
              type="button"
              className={`cbslot${isNew ? " new" : ""}`}
              style={fillVar(item)}
              aria-label={`${cap(item.name)}${n > 1 ? `, ×${n}` : ""}. Show how it's made`}
              title={cap(item.name)}
              onClick={() => onInfo(id)}
            >
              <Pictogram
                name={item.name}
                tier={item.tier}
                kind={item.kind}
                symbol={item.symbol}
              />
              {n > 1 && <b>{n}</b>}
            </button>
          );
        })}
        {!empty && <span className="cbslot cbslot-next" aria-hidden="true" />}
        {empty &&
          Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className="cbslot cbslot-ph" aria-hidden="true" />
          ))}
      </span>
      {empty && (
        <span className="cbshelf-empty">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
            <path d="M12 7v5l3 2" />
          </svg>
          <em>History</em>
        </span>
      )}
    </div>
  );
}
