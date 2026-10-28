"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pictogram } from "@/pictograms/Pictogram";
import { TIER, KIND, cap } from "@/lib/taxonomy";
import { formatFirstAppeared } from "@/lib/year";
import type { Confidence } from "@/db/schema";
import type { ExploreEdge } from "@/components/explore/types";

/**
 * Chip hover tooltip. Mirrors the prototype's `.tip` (around line 2475):
 * a dark pill that follows the mouse while hovering any chip in the stage,
 * showing a short preview of what the chip is and (for daily mode) whether
 * it's closed in puzzles.
 *
 * Positioning follows the prototype's `placeTip`: 14px right / 16px below
 * the pointer by default; flips to the opposite side when it would overflow.
 */
export function ChipTip({
  edge,
  dir,
  closedInPuzzles,
  mouse,
}: {
  edge: ExploreEdge | null;
  dir: "up" | "down";
  closedInPuzzles: boolean;
  mouse: { x: number; y: number } | null;
}) {
  const [mounted, setMounted] = useState(false);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  // Portal needs document; delay render until client-mount.
  useEffect(() => setMounted(true), []);

  // Reposition on mouse change.
  useEffect(() => {
    if (!edge || !mouse || !tipRef.current) return;
    const w = tipRef.current.offsetWidth;
    const h = tipRef.current.offsetHeight;
    let left = mouse.x + 14;
    let top = mouse.y + 16;
    if (left + w > window.innerWidth - 8) {
      left = Math.max(8, mouse.x - w - 14);
    }
    if (top + h > window.innerHeight - 8) {
      top = Math.max(8, mouse.y - h - 12);
    }
    setPos({ left, top });
  }, [edge, mouse]);

  if (!mounted || !edge || !mouse) return null;
  // Suppress unused-param lint: `dir` is reserved for future per-direction phrasing.
  void dir;

  const item = edge.item;
  const yr = formatFirstAppeared(item.firstAppeared);
  const firstSentence = firstSentenceOf(item.fact);

  const extras: string[] = [];
  if (yr) extras.push(yr.short);
  if (edge.hasEvidence) {
    extras.push(`evidence: ${confLabel(edge.confidence).toLowerCase()}`);
  }

  return createPortal(
    <div
      ref={tipRef}
      className="tip"
      role="tooltip"
      style={{ left: pos.left, top: pos.top }}
    >
      <span className="tt">
        <Pictogram
          name={item.name}
          tier={item.tier}
          kind={item.kind}
          symbol={item.symbol}
        />
        {cap(item.name)}
      </span>
      <span className="m">
        {TIER[item.tier].name} · {KIND[item.kind]}
      </span>
      {firstSentence ? <span>{firstSentence}</span> : null}
      {extras.length > 0 ? <span className="m">{extras.join(" · ")}</span> : null}
      {closedInPuzzles ? (
        <span className="tag bad">Closed in puzzles</span>
      ) : null}
    </div>,
    document.body,
  );
}

function firstSentenceOf(fact: string): string {
  if (!fact) return "";
  // Match the prototype's split: ". " that follows a period.
  const parts = fact.split(/(?<=\.)\s/);
  return parts[0] ?? fact;
}

function confLabel(c: Confidence): string {
  switch (c) {
    case "established":
      return "Established";
    case "strong":
      return "Strong";
    case "debated":
      return "Debated";
    case "hypothesis":
      return "Hypothesis";
  }
}
