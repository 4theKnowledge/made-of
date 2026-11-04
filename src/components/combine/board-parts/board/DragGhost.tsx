import React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";

export function DragGhost({
  tileId,
  bundle,
  x,
  y,
  size,
  verdict,
}: {
  tileId: string;
  bundle: ThemeBundle;
  x: number;
  y: number;
  size: number;
  /** Drop verdict badge: "ok" shows a checkmark, "bad" an ×, null hides it. */
  verdict: "ok" | "bad" | null;
}) {
  const item = bundle.items.get(tileId);
  if (!item) return null;
  // Centre horizontally on finger, lift it so the finger doesn't cover it.
  const style: React.CSSProperties = {
    left: `${x - size / 2}px`,
    top: `${y - size * 0.9}px`,
    width: `${size}px`,
    height: `${size}px`,
    ...fillVar(item),
  };
  // Drag ghost renders label-above-pictogram (unlike tray/board tiles) to
  // keep the item name visible while the finger hovers over the icon.
  const words = tileId.split("-");
  const longest = Math.max(0, ...words.map((w) => w.length));
  const lenClass = longest >= 10 ? " l2" : longest >= 7 ? " l1" : "";
  return (
    <div className="cbghost" style={style} aria-hidden="true">
      <span className={`cbn${lenClass}`}>{cap(item.name)}</span>
      <Pictogram
        name={item.name}
        tier={item.tier}
        kind={item.kind}
        symbol={item.symbol}
      />
      {verdict && (
        <span className={`cbghost-v cbghost-v-${verdict}`}>
          {verdict === "ok" ? "✓" : "✕"}
        </span>
      )}
    </div>
  );
}
