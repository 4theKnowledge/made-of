/**
 * Share text for Combine. Two shapes:
 *   - Daily: squares-per-age plus score + things made + top shelf item.
 *   - Endless: longer "points, finished things, longest chain" line.
 *
 * Ports cbDailyText + the endless text in cbSummary (prototype 3797, 3868).
 */

import type { ThemeBundle } from "./types";
import type { GameState } from "./engine";
import { TIER_VALUE } from "./engine";
import { cap } from "../lib/taxonomy";

const SHARE_URL = "https://madeof.app/combine";

export interface SharePayload {
  title: string;
  text: string;
  url: string;
}

export function dailyShareText(
  dayKey: string,
  state: GameState,
  bundle: ThemeBundle,
): SharePayload {
  const ages = bundle.theme.ages;
  const ageName = ages[state.chapter] ?? "";
  const top = bestShelfItem(state, bundle);
  // Target-list daily: squares show progress toward `target`, headline reads
  // `${found}/${target} in ${turns} turns`. Legacy daily (no target) keeps
  // the old age-progression line so old rows still render sensibly.
  const hasTarget = state.target != null && state.target > 0;
  const target = state.target ?? 0;
  const found = state.found.length;
  const squaresLen = hasTarget ? Math.min(10, target) : ages.length;
  const squares = hasTarget
    ? Array.from({ length: squaresLen }, (_, k) =>
        k < Math.min(found, squaresLen) ? "🟩" : "⬜",
      ).join("")
    : ages.map((_, k) => (k <= state.chapter ? "🟩" : "⬜")).join("");
  const headline = hasTarget
    ? `${squares} ${found}/${target} in ${state.moves} turn${state.moves === 1 ? "" : "s"}`
    : `${squares} reached ${ageName}`;
  const foundLine = !hasTarget && state.found.length
    ? ` · ${state.found.length} new discover${state.found.length > 1 ? "ies" : "y"}`
    : "";
  const chainLine = state.longest > 1 ? ` · longest chain ×${state.longest}` : "";
  const shelfLine = state.shelf.length
    ? ` · ${state.shelf.length} finished thing${state.shelf.length > 1 ? "s" : ""}`
    : "";
  const text =
    `Made Of · Daily Combine ${dayKey}\n` +
    `${headline}\n` +
    `${state.score.toLocaleString("en")} points · ${state.made} made${
      top ? ` · best: ${top}` : ""
    }${foundLine}${chainLine}${shelfLine}`;
  return {
    title: "Made Of · Daily Combine",
    text,
    url: `${SHARE_URL}?${dailyShareQuery(dayKey, {
      score: state.score,
      age: state.chapter,
      made: state.made,
      ageName,
      ageCount: ages.length,
      best: top,
      found: state.found.length,
      longest: state.longest,
      shelf: state.shelf.length,
      turns: state.moves,
      target: state.target ?? 0,
    })}`,
  };
}

/** Query string for the shared URL — kept in sync with /combine/og and
 *  the generateMetadata reader on /combine. Exported for the daily share
 *  rebuild path, which doesn't have a GameState in hand. */
export function dailyShareQuery(
  dayKey: string,
  r: {
    score: number;
    age: number;
    made: number;
    ageName: string;
    ageCount: number;
    best: string | null;
    found?: number;
    longest?: number;
    shelf?: number;
    turns?: number;
    target?: number;
  },
): string {
  const q = new URLSearchParams({
    d: dayKey,
    s: String(r.score),
    a: String(r.age),
    m: String(r.made),
    an: r.ageName,
    ac: String(r.ageCount),
  });
  if (r.best) q.set("b", r.best);
  if (r.found && r.found > 0) q.set("f", String(r.found));
  if (r.longest && r.longest > 1) q.set("lc", String(r.longest));
  if (r.shelf && r.shelf > 0) q.set("sh", String(r.shelf));
  if (r.turns && r.turns > 0) q.set("t", String(r.turns));
  if (r.target && r.target > 0) q.set("tg", String(r.target));
  return q.toString();
}

export function endlessShareText(
  state: GameState,
  bundle: ThemeBundle,
): SharePayload {
  const ages = bundle.theme.ages;
  const ageName = ages[state.chapter] ?? "";
  const top = bestShelfItem(state, bundle);
  const foundLine = state.found.length
    ? ` · ${state.found.length} new discover${state.found.length > 1 ? "ies" : "y"}`
    : "";
  const text =
    `Made Of · Combine (${bundle.theme.name})\n` +
    `${state.score.toLocaleString("en")} points · reached the ${ageName} age · ` +
    `${state.shelf.length} finished things · longest chain ×${state.longest || 1}` +
    foundLine;
  return {
    title: `Made Of · Combine · ${bundle.theme.name}`,
    text,
    url: `${SHARE_URL}?${modeShareQuery("endless", {
      score: state.score,
      age: state.chapter,
      made: state.made,
      ageName,
      ageCount: ages.length,
      themeName: bundle.theme.name,
      best: top,
      found: state.found.length,
      longest: state.longest,
      shelf: state.shelf.length,
    })}`,
  };
}

export function fastShareText(
  state: GameState,
  bundle: ThemeBundle,
): SharePayload {
  const top = bestShelfItem(state, bundle);
  const foundLine = state.found.length
    ? ` · ${state.found.length} new discover${state.found.length > 1 ? "ies" : "y"}`
    : "";
  const chainLine = state.longest > 1 ? ` · longest chain ×${state.longest}` : "";
  const shelfLine = state.shelf.length
    ? ` · ${state.shelf.length} finished thing${state.shelf.length > 1 ? "s" : ""}`
    : "";
  const text =
    `Made Of · Fast Combine (${bundle.theme.name})\n` +
    `${state.score.toLocaleString("en")} points · ${state.made} made${
      top ? ` · best: ${top}` : ""
    }${foundLine}${chainLine}${shelfLine}`;
  return {
    title: `Made Of · Fast Combine · ${bundle.theme.name}`,
    text,
    url: `${SHARE_URL}?${modeShareQuery("fast", {
      score: state.score,
      made: state.made,
      themeName: bundle.theme.name,
      best: top,
      found: state.found.length,
      longest: state.longest,
      shelf: state.shelf.length,
    })}`,
  };
}

/** Build share URL query for endless/fast. Daily uses its own `dailyShareQuery`
 *  so it can keep `d=<day>` as the identifying param. */
export function modeShareQuery(
  mode: "endless" | "fast",
  r: {
    score: number;
    made: number;
    themeName: string;
    best: string | null;
    found?: number;
    longest?: number;
    shelf?: number;
    age?: number;
    ageName?: string;
    ageCount?: number;
  },
): string {
  const q = new URLSearchParams({
    mo: mode,
    s: String(r.score),
    m: String(r.made),
    tn: r.themeName,
  });
  if (mode === "endless") {
    if (typeof r.age === "number") q.set("a", String(r.age));
    if (r.ageName) q.set("an", r.ageName);
    if (typeof r.ageCount === "number") q.set("ac", String(r.ageCount));
  }
  if (r.best) q.set("b", r.best);
  if (r.found && r.found > 0) q.set("f", String(r.found));
  if (r.longest && r.longest > 1) q.set("lc", String(r.longest));
  if (r.shelf && r.shelf > 0) q.set("sh", String(r.shelf));
  return q.toString();
}

/** Resolve an item id (uuid) to its display name. Falls back to the input
 *  so legacy stored results that already hold a name still render. */
export function resolveItemName(
  id: string | null | undefined,
  bundle: ThemeBundle,
): string | null {
  if (!id) return null;
  const item = bundle.items.get(id);
  return cap(item?.name ?? id);
}

/** The highest-tier item on the shelf (prototype's "top: shelf.slice().sort(...)[0]"). */
function bestShelfItem(
  state: GameState,
  bundle: ThemeBundle,
): string | null {
  if (state.shelf.length === 0) return null;
  const sorted = [...state.shelf].sort((a, b) => {
    const ta = bundle.items.get(a)?.tier ?? "M";
    const tb = bundle.items.get(b)?.tier ?? "M";
    return (TIER_VALUE[tb] ?? 2) - (TIER_VALUE[ta] ?? 2);
  });
  const id = sorted[0];
  return resolveItemName(id, bundle);
}

/** Fire the native share sheet if available, else write to clipboard.
 *  Accepts a {title, text, url} payload so the OS share sheet can render
 *  a rich preview; falls back to a flat "text\nurl" string on clipboard. */
export async function shareText(
  payload: SharePayload | string,
): Promise<"shared" | "copied" | "failed"> {
  if (typeof navigator === "undefined") return "failed";
  const p: SharePayload =
    typeof payload === "string"
      ? { title: "Made Of", text: payload, url: "" }
      : payload;
  const nav = navigator as Navigator & {
    share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    canShare?: (data: { title?: string; text?: string; url?: string }) => boolean;
  };
  if (nav.share) {
    // When a URL is present, share URL-only so iMessage (and most OS share
    // sheets) render a Rich Link preview from our OG card. Including `text`
    // alongside `url` drops iMessage into the compact bubble with no image.
    const data = p.url
      ? { title: p.title, url: p.url }
      : { title: p.title, text: p.text };
    if (!nav.canShare || nav.canShare(data)) {
      try {
        await nav.share(data);
        return "shared";
      } catch {
        // User cancelled or share failed; try clipboard as fallback.
      }
    }
  }
  const flat = p.url ? `${p.text}\n${p.url}` : p.text;
  try {
    await navigator.clipboard.writeText(flat);
    return "copied";
  } catch {
    return "failed";
  }
}
