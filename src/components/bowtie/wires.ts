/**
 * SVG wires between side chips and the focus card.
 *
 * Mirrors the artifact's `drawWires` (around line 1858). We measure every
 * chip in both columns with getBoundingClientRect, compute cubic Bezier
 * paths relative to the stage, and set them as the SVG's children.
 *
 * Dash patterns and the `weak` class for debated/hypothesis evidence are
 * ported verbatim from the prototype's REL.dash table.
 */

import type { LinkType } from "@/db/schema";
import { REL } from "@/lib/rel";

export interface WireChipInfo {
  el: HTMLElement;
  side: "up" | "down";
  type: LinkType;
  weak: boolean;
  /** Stable key used for hover highlighting (matches the chip's data-k). */
  dataKey: string;
}

export function drawWires(
  stage: HTMLElement,
  focus: HTMLElement,
  wiresSvg: SVGSVGElement,
  chips: WireChipInfo[],
) {
  const sr = stage.getBoundingClientRect();
  const fr = focus.getBoundingClientRect();
  wiresSvg.setAttribute("viewBox", `0 0 ${sr.width} ${sr.height}`);

  // Clear existing paths.
  while (wiresSvg.firstChild) wiresSvg.removeChild(wiresSvg.firstChild);

  const byCol = {
    up: chips.filter((c) => c.side === "up"),
    down: chips.filter((c) => c.side === "down"),
  };

  (["up", "down"] as const).forEach((side) => {
    const list = byCol[side];
    list.forEach((c, i) => {
      const r = c.el.getBoundingClientRect();
      // Account for any CSS transform the stage animation might apply to
      // chips. The artifact reads the computed transform matrix.
      const tx = readTranslationX(c.el);
      const left = r.left - tx;
      const right = r.right - tx;

      const fy =
        fr.top -
        sr.top +
        fr.height *
          (0.22 + 0.56 * (list.length > 1 ? i / (list.length - 1) : 0.5));

      let x1: number, y1: number, x2: number, y2: number;
      if (side === "up") {
        x1 = right - sr.left;
        y1 = r.top + r.height / 2 - sr.top;
        x2 = fr.left - sr.left;
        y2 = fy;
      } else {
        x1 = fr.right - sr.left;
        y1 = fy;
        x2 = left - sr.left;
        y2 = r.top + r.height / 2 - sr.top;
      }
      const m = (x2 - x1) * 0.5;

      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute(
        "d",
        `M${x1} ${y1} C${x1 + m} ${y1}, ${x2 - m} ${y2}, ${x2} ${y2}`,
      );
      path.setAttribute(
        "stroke",
        getComputedStyle(document.documentElement)
          .getPropertyValue("--ink")
          .trim(),
      );
      const dash = REL[c.type].dash;
      if (dash) {
        path.setAttribute("stroke-dasharray", dash);
        path.setAttribute("stroke-linecap", "round");
      }
      if (c.weak) path.classList.add("weak");
      path.dataset.k = side + c.dataKey;
      wiresSvg.appendChild(path);
    });
  });
}

function readTranslationX(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  // matrix(a, b, c, d, tx, ty) or matrix3d(…, m41, m42, …)
  const m = /^matrix\(([^)]+)\)$/.exec(t);
  if (m) {
    const parts = m[1].split(",").map((x) => parseFloat(x.trim()));
    return parts[4] ?? 0;
  }
  const m3 = /^matrix3d\(([^)]+)\)$/.exec(t);
  if (m3) {
    const parts = m3[1].split(",").map((x) => parseFloat(x.trim()));
    return parts[12] ?? 0;
  }
  return 0;
}
