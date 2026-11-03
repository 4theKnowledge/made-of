import React, { useEffect, useRef, useState } from "react";
import type { ChainTrace } from "@/components/combine/board-parts/types";

export function ChainOverlay({ trace }: { trace: ChainTrace }) {
  // Measure cell geometry relative to the board. We re-measure once on
  // mount — the board doesn't resize mid-chain, so a single pass is
  // enough. Everything after that is pure CSS keyframes.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [geo, setGeo] = useState<{ w: number; h: number; centers: Map<number, { x: number; y: number }> } | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const board = svg.parentElement;
    if (!board) return;
    const br = board.getBoundingClientRect();
    const centers = new Map<number, { x: number; y: number }>();
    const cells = board.querySelectorAll<HTMLElement>("[data-cb]");
    cells.forEach((el) => {
      const idx = Number(el.getAttribute("data-cb"));
      if (!Number.isFinite(idx)) return;
      const r = el.getBoundingClientRect();
      centers.set(idx, {
        x: r.left - br.left + r.width / 2,
        y: r.top - br.top + r.height / 2,
      });
    });
    setGeo({ w: br.width, h: br.height, centers });
  }, [trace]);

  const cls = `cbchainfx${trace.solo ? " cbchainfx-solo" : ""}`;
  if (!geo) {
    return (
      <svg
        ref={svgRef}
        className={cls}
        aria-hidden="true"
      />
    );
  }

  const stroke = `var(--f${trace.tier})`;
  return (
    <svg
      ref={svgRef}
      className={cls}
      viewBox={`0 0 ${geo.w} ${geo.h}`}
      width={geo.w}
      height={geo.h}
      aria-hidden="true"
    >
      {trace.steps.map((step, si) => {
        const to = geo.centers.get(step.to);
        if (!to) return null;
        return (
          <g key={si}>
            {step.from.map((fromCell, fi) => {
              if (fromCell === step.to) return null;
              const from = geo.centers.get(fromCell);
              if (!from) return null;
              // Curved path — midpoint pulled toward the output and
              // offset perpendicular so parallel arcs don't overlap.
              const mx = (from.x + to.x) / 2;
              const my = (from.y + to.y) / 2;
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const len = Math.hypot(dx, dy) || 1;
              const nx = -dy / len;
              const ny = dx / len;
              const bend = 14 + fi * 6;
              const cx = mx + nx * bend;
              const cy = my + ny * bend;
              const d = `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
              return (
                <path
                  key={fi}
                  className="cbchain-arc"
                  d={d}
                  stroke={stroke}
                  style={{ animationDelay: `${step.drawAt}ms` } as React.CSSProperties}
                />
              );
            })}
            <circle
              className="cbchain-node"
              cx={to.x}
              cy={to.y}
              r={5}
              fill={stroke}
              style={{ animationDelay: `${step.drawAt + 150}ms` } as React.CSSProperties}
            />
          </g>
        );
      })}
    </svg>
  );
}
