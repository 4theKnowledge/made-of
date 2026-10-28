/**
 * The `.ic` tile from the prototype. See globals.css `.ic` and friends.
 *
 * Three cases:
 *   - Element with a symbol → render the letter symbol tile (`.ic.el`).
 *   - Named item in PICTO    → render its specific SVG.
 *   - Fallback by kind       → render KIND_PICTO[kind].
 *
 * The tile's fill colour is tier-pastel (`--fF`..`--fS`) exactly as the
 * prototype does. We never use colour tokens inline; the parent sets a
 * `--fill` CSS variable so dark mode and the Focus card's inverted palette
 * continue to work unchanged.
 */

import type { ItemKind, Tier } from "@/db/schema";
import { KIND_PICTO, PICTO } from "./data";

type PictoKindMap = Record<string, string>;

const TIER_FILL: Record<Tier, string> = {
  F: "var(--fF)",
  N: "var(--fN)",
  M: "var(--fM)",
  C: "var(--fC)",
  P: "var(--fP)",
  S: "var(--fS)",
};

export interface PictogramProps {
  /** The item's lowercase name (as in DATA), used to look up a specific picto. */
  name: string;
  tier: Tier;
  kind: ItemKind;
  /** Element symbol like "H", "Fe". If present, we render the letter tile. */
  symbol?: string | null;
  /** Optional pixel size override; defaults to CSS. */
  size?: number;
  /** Extra class names (prototype adds `sm` or similar). */
  className?: string;
}

export function Pictogram({
  name,
  tier,
  kind,
  symbol,
  size,
  className,
}: PictogramProps) {
  const style = {
    "--fill": TIER_FILL[tier],
    ...(size ? { width: size, height: size } : {}),
  } as React.CSSProperties;

  if (symbol) {
    return (
      <span className={`ic el${className ? ` ${className}` : ""}`} style={style}>
        <b>{symbol}</b>
      </span>
    );
  }

  const svg =
    (PICTO as PictoKindMap)[name] ??
    (KIND_PICTO as PictoKindMap)[kind] ??
    "";

  return (
    <span className={`ic${className ? ` ${className}` : ""}`} style={style}>
      <svg
        viewBox="0 0 32 32"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </span>
  );
}
