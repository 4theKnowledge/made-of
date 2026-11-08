import React from "react";

/**
 * Shimmer placeholder for the board + trays while a save is being
 * restored. Matches the real `.cbboard` + `.cbtray` + `.cbshelf.cbhold`
 * geometry so the switchover is a pure fade — no layout shift. Used by
 * `CombineBoard` during the mount-time resume window; see T-0228.
 */
export function BoardPlaceholder({
  size = 6,
  traySlots = 3,
  holdSlots = 3,
}: {
  size?: number;
  traySlots?: number;
  holdSlots?: number;
}) {
  return (
    <div className="cb-skel" aria-hidden="true">
      <div
        className="cbboard cb-skel-board"
        style={{ "--cbn": size } as React.CSSProperties}
      >
        {Array.from({ length: size * size }).map((_, i) => (
          <span key={i} className="cbc cb-skel-cell" />
        ))}
      </div>
      <div className="cbholdrow cb-skel-holdrow">
        <div className="cbshelf cbhold cb-skel-hold">
          <span className="cbshelf-slots">
            {Array.from({ length: holdSlots }).map((_, i) => (
              <span key={i} className="cbslot cbslot-ph cb-skel-slot" />
            ))}
          </span>
        </div>
      </div>
      <div className="cbtray cb-skel-tray">
        {Array.from({ length: traySlots }).map((_, i) => (
          <span key={i} className="cbp cb-skel-tile" />
        ))}
      </div>
    </div>
  );
}
