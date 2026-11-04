import React, { useEffect, useRef, useState } from "react";
import type { GameState } from "@/combine/engine";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import type { Fx } from "@/components/combine/board-parts/types";
import { CombineTile } from "@/components/combine/board-parts/CombineTile";

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
  // Every make shows here (ingredients-that-are-also-outputs, mids, and
  // terminal shipped items alike). `found` is first-time-discovery order;
  // newest-first reads better here so recent activity is always visible
  // without scrolling.
  const ids = [...state.found].reverse();
  const empty = ids.length === 0;
  // Flash the most recent discovery when its sparkle fx fires. Repeats
  // don't flash — the badge count change is the cue.
  const freshlyMade = fx.discover != null ? ids[0] ?? null : null;
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
  }, [ids.length]);
  return (
    <div
      ref={shelfRef}
      className={`cbshelf${empty ? " none" : ""}${overflow.left ? " ov-l" : ""}${overflow.right ? " ov-r" : ""}`}
      aria-label={`Made this run: ${ids.length}`}
    >
      <span className="cbshelf-slots">
        {ids.map((id) => {
          const item = bundle.items.get(id);
          if (!item) return null;
          const n = state.madeCounts[id] ?? 1;
          const isNew = id === freshlyMade;
          return (
            <CombineTile
              key={id}
              variant="slot"
              item={item}
              className={isNew ? "new" : undefined}
              aria-label={`${cap(item.name)}${n > 1 ? `, ×${n}` : ""}. Show how it's made`}
              title={cap(item.name)}
              onClick={() => onInfo(id)}
            >
              {n > 1 && <b>{n}</b>}
            </CombineTile>
          );
        })}
        {!empty && <span className="cbslot cbslot-next" aria-hidden="true" />}
        {empty &&
          Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className="cbslot cbslot-ph" aria-hidden="true" />
          ))}
      </span>
      <span className="cbshelf-empty cbshelf-tally" aria-hidden="true">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
        {empty ? <em>History</em> : <em>{ids.length} made</em>}
      </span>
    </div>
  );
}
