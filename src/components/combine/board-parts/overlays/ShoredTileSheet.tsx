import React from "react";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";
import { Pictogram } from "@/pictograms/Pictogram";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";
import type { CombineItem } from "@/combine/types";

/**
 * Action sheet shown when the player long-presses a shored tile. Two
 * choices: release the shore (no refund — see engine.ts `unshore` case)
 * or see the tile's info. Cancel via scrim/Escape.
 *
 * Shore is spent on application; releasing is a mis-tap recovery, not a
 * way to reclaim a charge. Copy makes that clear so the player doesn't
 * expect a refund.
 */
export function ShoredTileSheet({
  item,
  onRelease,
  onInfo,
  onDismiss,
}: {
  item: CombineItem | null;
  onRelease: () => void;
  onInfo: () => void;
  onDismiss: () => void;
}) {
  const label = item ? cap(item.name) : "Steadied tile";
  return (
    <ResponsiveSheet open onDismiss={onDismiss} ariaLabel={`Actions for ${label}`}>
      {item && (
        <span
          className="cbopt-chip"
          style={fillVar(item)}
          aria-hidden="true"
        >
          <Pictogram
            name={item.name}
            tier={item.tier}
            kind={item.kind}
            symbol={item.symbol}
          />
        </span>
      )}
      <span className="k">{label}</span>
      <p className="sub">
        This tile is steadied. Releasing it lets it start crumbling again.
        The shore charge stays spent.
      </p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          width: "100%",
          marginTop: 4,
        }}
      >
        <button type="button" className="btn" onClick={onInfo}>
          See info
        </button>
        <button type="button" className="btn" onClick={onRelease}>
          Release shore
        </button>
        <button type="button" className="btn ghost" onClick={onDismiss}>
          Cancel
        </button>
      </div>
    </ResponsiveSheet>
  );
}
