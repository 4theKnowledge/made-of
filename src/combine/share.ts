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

export function dailyShareText(
  dayKey: string,
  state: GameState,
  bundle: ThemeBundle,
): string {
  const ages = bundle.theme.ages;
  const squares = ages
    .map((_, k) => (k <= state.age ? "🟩" : "⬜"))
    .join("");
  const ageName = ages[state.age];
  const top = bestShelfItem(state, bundle);
  return (
    `Made Of · Daily Combine ${dayKey}\n` +
    `${squares} reached ${ageName}\n` +
    `${state.score.toLocaleString("en")} points · ${state.made} made${
      top ? ` · best: ${top}` : ""
    }\n` +
    SHARE_URL
  );
}

export function endlessShareText(
  state: GameState,
  bundle: ThemeBundle,
): string {
  const ageName = bundle.theme.ages[state.age];
  const foundLine = state.found.length
    ? ` · ${state.found.length} new discover${state.found.length > 1 ? "ies" : "y"}`
    : "";
  return (
    `Made Of · Combine (${bundle.theme.name})\n` +
    `${state.score.toLocaleString("en")} points · reached the ${ageName} age · ` +
    `${state.shelf.length} finished things · longest chain ×${state.longest || 1}` +
    foundLine +
    `\n${SHARE_URL}`
  );
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
  return id ? cap(id) : null;
}

/** Fire the native share sheet if available, else write to clipboard. */
export async function shareText(text: string): Promise<"shared" | "copied" | "failed"> {
  if (typeof navigator === "undefined") return "failed";
  const nav = navigator as Navigator & {
    share?: (data: { text: string }) => Promise<void>;
  };
  if (nav.share) {
    try {
      await nav.share({ text });
      return "shared";
    } catch {
      // User cancelled or share failed; try clipboard as fallback.
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
