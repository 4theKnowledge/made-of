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
  const squares = ages
    .map((_, k) => (k <= state.age ? "🟩" : "⬜"))
    .join("");
  const ageName = ages[state.age];
  const top = bestShelfItem(state, bundle);
  const text =
    `Made Of · Daily Combine ${dayKey}\n` +
    `${squares} reached ${ageName}\n` +
    `${state.score.toLocaleString("en")} points · ${state.made} made${
      top ? ` · best: ${top}` : ""
    }`;
  return {
    title: "Made Of · Daily Combine",
    text,
    url: `${SHARE_URL}?d=${encodeURIComponent(dayKey)}`,
  };
}

export function endlessShareText(
  state: GameState,
  bundle: ThemeBundle,
): SharePayload {
  const ageName = bundle.theme.ages[state.age];
  const foundLine = state.found.length
    ? ` · ${state.found.length} new discover${state.found.length > 1 ? "ies" : "y"}`
    : "";
  const text =
    `Made Of · Combine (${bundle.theme.name})\n` +
    `${state.score.toLocaleString("en")} points · reached the ${ageName} age · ` +
    `${state.shelf.length} finished things · longest chain ×${state.longest || 1}` +
    foundLine;
  return {
    title: "Made Of · Combine",
    text,
    url: SHARE_URL,
  };
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
    const data = { title: p.title, text: p.text, url: p.url || undefined };
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
