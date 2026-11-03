/**
 * The `.ic` tile from the prototype. See globals.css `.ic` and friends.
 *
 * Four lookup cases, highest priority first:
 *   - Caller supplies `pictogram` prop (from the DB)              → use it.
 *   - Element with a symbol                                       → letter tile.
 *   - Overrides map populated by the snapshot (DB-sourced)        → use that.
 *   - Named item in PICTO / KIND_PICTO (the legacy data.ts set)   → fallback.
 *
 * The overrides map is hydrated by `applyPictogramOverrides()`, which the
 * snapshot loader calls once at boot and on every reload. This keeps the
 * component synchronous (client + server callers unchanged) while letting
 * admin edits take effect without a code deploy.
 *
 * The tile's fill colour is tier-pastel (`--fF`..`--fS`) exactly as the
 * prototype does. We never use colour tokens inline; the parent sets a
 * `--fill` CSS variable so dark mode and the Focus card's inverted palette
 * continue to work unchanged.
 */

import type { ItemKind, Tier } from "@/db/schema";
import { KIND_PICTO, PICTO } from "./data";

type PictoKindMap = Record<string, string>;

// Module-level override maps, populated by the live snapshot. Keyed by
// item name (lowercase) and kind code. `null` entries aren't stored —
// absence means "fall back to the next layer".
const itemOverrides = new Map<string, string>();
const kindOverrides = new Map<string, string>();

export function applyPictogramOverrides(
  items: Map<string, string>,
  kinds: Map<string, string>,
) {
  itemOverrides.clear();
  for (const [name, svg] of items) itemOverrides.set(name, svg);
  kindOverrides.clear();
  for (const [code, svg] of kinds) kindOverrides.set(code, svg);
}

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
  /** DB-sourced SVG inner-markup. When supplied, takes precedence over
   *  every other lookup. Server components with access to the graph node
   *  (which carries `pictogram`) should pass this through. */
  pictogram?: string | null;
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
  pictogram,
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
    pictogram ??
    itemOverrides.get(name) ??
    (PICTO as PictoKindMap)[name] ??
    kindOverrides.get(kind) ??
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
