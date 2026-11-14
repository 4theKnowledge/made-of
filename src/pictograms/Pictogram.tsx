"use client";

/**
 * The `.ic` tile from the prototype. See globals.css `.ic` and friends.
 *
 * Lookup order (highest priority first):
 *   - Caller supplies `pictogram` prop (from the DB)             → use it.
 *   - Element with a `symbol`                                    → letter tile.
 *   - `itemOverrides` map (hydrated from the live snapshot)      → use it.
 *   - `kindOverrides` map (hydrated from the live snapshot)      → use it.
 *   - Client-side fetch of /api/pictograms/item/<name>, then
 *     /api/pictograms/kind/<kind>                                → populate the
 *     maps and re-render. Edge-cached by name/kind so the second
 *     tile that needs the same pictogram is free.
 *
 * Server-side: the maps are hydrated by `applyPictogramOverrides()` which
 * `src/graph/live.ts` calls at boot. Any tile the server renders therefore
 * resolves synchronously — the client-side fetch is only for tiles that
 * first appear on the client (e.g. a Combine tile crumbling in).
 *
 * The tile's fill colour is tier-pastel (`--fF`..`--fS`) exactly as the
 * prototype does. We never use colour tokens inline; the parent sets a
 * `--fill` CSS variable so dark mode and the Focus card's inverted palette
 * continue to work unchanged.
 */

import { useEffect, useState } from "react";
import type { ItemKind, Tier } from "@/db/schema";

// Module-level override maps, populated by the live snapshot server-side
// and by client-side fetches when a name/kind is seen on the client for
// the first time. `null` entries aren't stored — absence means "fall back
// to the next layer".
const itemOverrides = new Map<string, string>();
const kindOverrides = new Map<string, string>();

// Dedupe in-flight fetches so N concurrent renders of the same name
// trigger exactly one network request.
const itemInFlight = new Map<string, Promise<string | null>>();
const kindInFlight = new Map<string, Promise<string | null>>();

// Simple pub-sub: when a fetch resolves, re-render every mounted Pictogram
// that was waiting on it. Keyed by item name or kind code.
type Subscriber = () => void;
const itemSubs = new Map<string, Set<Subscriber>>();
const kindSubs = new Map<string, Set<Subscriber>>();

function subscribe(
  bucket: Map<string, Set<Subscriber>>,
  key: string,
  cb: Subscriber,
) {
  let set = bucket.get(key);
  if (!set) {
    set = new Set();
    bucket.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) bucket.delete(key);
  };
}

function notify(bucket: Map<string, Set<Subscriber>>, key: string) {
  const set = bucket.get(key);
  if (!set) return;
  for (const cb of set) cb();
}

export function applyPictogramOverrides(
  items: Map<string, string>,
  kinds: Map<string, string>,
) {
  itemOverrides.clear();
  for (const [name, svg] of items) itemOverrides.set(name, svg);
  kindOverrides.clear();
  for (const [code, svg] of kinds) kindOverrides.set(code, svg);
}

async function fetchItemPictogram(name: string): Promise<string | null> {
  let p = itemInFlight.get(name);
  if (p) return p;
  p = fetch(`/api/pictograms/item/${encodeURIComponent(name)}`, {
    credentials: "same-origin",
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ svg: string | null }>) : null))
    .then((j) => {
      const svg = j?.svg ?? null;
      if (svg) itemOverrides.set(name, svg);
      notify(itemSubs, name);
      return svg;
    })
    .catch(() => null)
    .finally(() => {
      itemInFlight.delete(name);
    });
  itemInFlight.set(name, p);
  return p;
}

async function fetchKindPictogram(code: string): Promise<string | null> {
  let p = kindInFlight.get(code);
  if (p) return p;
  p = fetch(`/api/pictograms/kind/${encodeURIComponent(code)}`, {
    credentials: "same-origin",
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ svg: string | null }>) : null))
    .then((j) => {
      const svg = j?.svg ?? null;
      if (svg) kindOverrides.set(code, svg);
      notify(kindSubs, code);
      return svg;
    })
    .catch(() => null)
    .finally(() => {
      kindInFlight.delete(code);
    });
  kindInFlight.set(code, p);
  return p;
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

  // useState seeds from the sync lookup; useEffect triggers the async
  // fetch if the seed came up empty. Rendered once with whatever is
  // available, then re-rendered when the fetch resolves.
  const [itemSvg, setItemSvg] = useState<string | undefined>(() =>
    itemOverrides.get(name),
  );
  const [kindSvg, setKindSvg] = useState<string | undefined>(() =>
    kindOverrides.get(kind),
  );

  useEffect(() => {
    // Short-circuit if the symbol path will be taken or a prop is passed.
    if (symbol || pictogram) return;

    let cancelled = false;

    // Subscribe first so a concurrent fetch landing while we're setting
    // up still reaches us.
    const unsubItem = subscribe(itemSubs, name, () => {
      if (cancelled) return;
      setItemSvg(itemOverrides.get(name));
    });
    const unsubKind = subscribe(kindSubs, kind, () => {
      if (cancelled) return;
      setKindSvg(kindOverrides.get(kind));
    });

    if (!itemOverrides.has(name)) {
      void fetchItemPictogram(name);
    }
    if (!kindOverrides.has(kind)) {
      void fetchKindPictogram(kind);
    }

    return () => {
      cancelled = true;
      unsubItem();
      unsubKind();
    };
  }, [name, kind, symbol, pictogram]);

  if (symbol) {
    return (
      <span className={`ic el${className ? ` ${className}` : ""}`} style={style}>
        <b>{symbol}</b>
      </span>
    );
  }

  const svg = pictogram ?? itemSvg ?? kindSvg ?? "";

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
