import type React from "react";
import type { CombineItem } from "@/combine/types";

/** navigator.vibrate wrapper that silently no-ops on unsupported devices. */
export function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // ignore
  }
}

export function fillVar(item: CombineItem): React.CSSProperties {
  // Pastel tier fill, with --pk left as the global ink colour — matches the
  // prototype's `icon()` which only sets --fill. Borders and drop shadows
  // on .cbc.full / .cbp are already keyed to --pk through the stylesheet.
  return { "--fill": `var(--f${item.tier})` } as React.CSSProperties;
}

export function formatDailyLabel(dayKey: string): string {
  // dayKey is YYYY-MM-DD; parse as local (avoid UTC shift) and show "Mon D".
  const [y, m, d] = dayKey.split("-").map((n) => Number(n));
  if (!y || !m || !d) return dayKey;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
