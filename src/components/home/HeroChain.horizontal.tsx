"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CombineTile } from "@/components/combine/board-parts/CombineTile";
import type { CombineItem } from "@/combine/types";
import type { ItemKind, Tier } from "@/db/schema";

export interface TreeItem {
  slug: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  symbol: string | null;
  pictogram: string | null;
}

export interface ChainStage {
  id: string;
  era?: string;
  inputs: TreeItem[];
  final: TreeItem;
}

// Fixed vertical geometry so arrow endpoints are computed without DOM reads.
const SLOT_H = 88;
const TRACK_H = 360;
const GAP_W = 160;
const TRUNK_X = 0.55; // where (0–1 across the gap) orthogonal trunks sit

// Pace of the step-pan animation. The pan starts BEFORE the beam fully
// finishes so the whole thing reads as one continuous flow rather than
// draw-pause-pan.
const PAN_MS = 900; // how long the camera glides to the next column
const PAN_START_OFFSET_MS = 250; // start panning this long after a beam begins
const KICKOFF_MS = 450; // hold on col 0 before drawing the first link
const RESET_PAN_MS = 650; // on replay, glide back to col 0 instead of snapping

type Column = {
  id: string;
  items: Array<{
    key: string;
    item: TreeItem;
    isFinal: boolean;
    isFinale: boolean;
  }>;
  isFinal: boolean;
  isFinale: boolean;
};

type Edge = {
  fromCol: number;
  fromSlot: number;
  toCol: number;
  toSlot: number;
};

type Flat = {
  columns: Column[];
  edges: Edge[];
  eras: Record<number, string | undefined>;
};

function flatten(stages: ChainStage[]): Flat {
  const columns: Column[] = [];
  const edges: Edge[] = [];
  const eras: Record<number, string | undefined> = {};

  stages.forEach((stage, si) => {
    const isFinaleStage = si === stages.length - 1;
    const prevFinalCol = columns.length - 1;
    const prevFinalColumn = prevFinalCol >= 0 ? columns[prevFinalCol] : null;
    const prevFinalSlug =
      prevFinalColumn && prevFinalColumn.isFinal
        ? prevFinalColumn.items[0]?.item.slug
        : undefined;
    const reuses =
      prevFinalSlug !== undefined && stage.inputs[0]?.slug === prevFinalSlug;

    let inputsCol: number;

    if (reuses && prevFinalColumn) {
      const siblings = stage.inputs.slice(1);
      siblings.forEach((it, i) => {
        prevFinalColumn.items.push({
          key: `${stage.id}-sib-${i}`,
          item: it,
          isFinal: false,
          isFinale: false,
        });
      });
      inputsCol = prevFinalCol;
    } else {
      columns.push({
        id: `${stage.id}-in`,
        items: stage.inputs.map((it, i) => ({
          key: `${stage.id}-in-${i}`,
          item: it,
          isFinal: false,
          isFinale: false,
        })),
        isFinal: false,
        isFinale: false,
      });
      inputsCol = columns.length - 1;

      // Editorial fan-out: previous final → every input of this stage.
      if (si > 0 && prevFinalColumn && prevFinalColumn.isFinal) {
        stage.inputs.forEach((_, slot) => {
          edges.push({
            fromCol: prevFinalCol,
            fromSlot: 0,
            toCol: inputsCol,
            toSlot: slot,
          });
        });
      }
    }

    columns.push({
      id: `${stage.id}-final`,
      items: [
        {
          key: `${stage.id}-final`,
          item: stage.final,
          isFinal: true,
          isFinale: isFinaleStage,
        },
      ],
      isFinal: true,
      isFinale: isFinaleStage,
    });
    const finalCol = columns.length - 1;

    const effectiveInputs = columns[inputsCol];
    effectiveInputs.items.forEach((_, slot) => {
      edges.push({
        fromCol: inputsCol,
        fromSlot: slot,
        toCol: finalCol,
        toSlot: 0,
      });
    });

    eras[finalCol] = stage.era;
  });

  return { columns, edges, eras };
}

function slotY(slotIndex: number, columnSize: number, pitch: number): number {
  const colH = columnSize * pitch;
  const top = (TRACK_H - colH) / 2;
  return top + slotIndex * pitch + pitch / 2;
}

export function HeroChain({ stages }: { stages: ChainStage[] }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef<Array<HTMLDivElement | null>>([]);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const panRafRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const [pass, setPass] = useState(0);
  const [playing, setPlaying] = useState(true);
  // revealedUpTo = index of the last column whose incoming arrow has started
  // drawing. Column 0 is revealed immediately.
  const [revealedUpTo, setRevealedUpTo] = useState(0);

  const flat = useMemo(() => flatten(stages), [stages]);
  columnRefs.current = columnRefs.current.slice(0, flat.columns.length);

  // Center a given column in the scroll viewport, animated.
  const panTo = (targetScrollLeft: number, durMs: number) =>
    new Promise<void>((resolve) => {
      const el = scrollRef.current;
      if (!el) return resolve();
      const from = el.scrollLeft;
      const delta = targetScrollLeft - from;
      if (Math.abs(delta) < 1 || durMs <= 0) {
        el.scrollLeft = targetScrollLeft;
        return resolve();
      }
      const start = performance.now();
      const tick = (now: number) => {
        if (cancelledRef.current) return resolve();
        const t = Math.min(1, (now - start) / durMs);
        // easeInOutCubic: glides in and out, no snap
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        el.scrollLeft = from + delta * e;
        if (t < 1) {
          panRafRef.current = requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      panRafRef.current = requestAnimationFrame(tick);
    });

  const centerScrollForCol = (ci: number): number => {
    const scrollEl = scrollRef.current;
    const colEl = columnRefs.current[ci];
    if (!scrollEl || !colEl) return 0;
    const colLeft = colEl.offsetLeft;
    const colWidth = colEl.offsetWidth;
    const viewport = scrollEl.clientWidth;
    const target = colLeft - (viewport - colWidth) / 2;
    const max = scrollEl.scrollWidth - viewport;
    return Math.max(0, Math.min(max, target));
  };

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (panRafRef.current) cancelAnimationFrame(panRafRef.current);
    panRafRef.current = null;
  };

  // Drive the step-pan sequence.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    cancelledRef.current = false;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced) {
      setRevealedUpTo(flat.columns.length - 1);
      scroll.scrollLeft = 0;
      setPlaying(false);
      return;
    }

    // Cancel on any user input.
    const cancel = () => {
      cancelledRef.current = true;
      clearTimers();
      setPlaying(false);
      setRevealedUpTo(flat.columns.length - 1);
    };
    scroll.addEventListener("pointerdown", cancel, { passive: true });
    scroll.addEventListener("wheel", cancel, { passive: true });
    scroll.addEventListener("touchstart", cancel, { passive: true });
    scroll.addEventListener("keydown", cancel);

    setRevealedUpTo(0);

    const runStep = async (ci: number) => {
      if (cancelledRef.current) return;
      if (ci >= flat.columns.length) {
        setPlaying(false);
        return;
      }
      setRevealedUpTo(ci);
      await new Promise<void>((r) => {
        const t = setTimeout(r, PAN_START_OFFSET_MS);
        timersRef.current.push(t);
      });
      if (cancelledRef.current) return;
      await panTo(centerScrollForCol(ci), PAN_MS);
      if (cancelledRef.current) return;
      runStep(ci + 1);
    };

    // On first mount, snap to col 0 and hold briefly before drawing links.
    // On replay, the user is likely scrolled to the far right from the
    // previous end state — glide back to col 0 first instead of snapping,
    // then hold.
    const start = async () => {
      const target = centerScrollForCol(0);
      const current = scroll.scrollLeft;
      if (pass === 0 || Math.abs(current - target) < 2) {
        scroll.scrollLeft = target;
      } else {
        await panTo(target, RESET_PAN_MS);
      }
      if (cancelledRef.current) return;
      await new Promise<void>((r) => {
        const t = setTimeout(r, KICKOFF_MS);
        timersRef.current.push(t);
      });
      if (cancelledRef.current) return;
      runStep(1);
    };
    start();

    return () => {
      cancelledRef.current = true;
      clearTimers();
      scroll.removeEventListener("pointerdown", cancel);
      scroll.removeEventListener("wheel", cancel);
      scroll.removeEventListener("touchstart", cancel);
      scroll.removeEventListener("keydown", cancel);
    };
  }, [pass, flat.columns.length]);

  const replay = () => {
    setPlaying(true);
    setPass((p) => p + 1);
  };

  if (stages.length === 0) return null;

  // Group edges by source column (= gap index).
  const edgesByGap = new Map<number, Edge[]>();
  for (const e of flat.edges) {
    const list = edgesByGap.get(e.fromCol) ?? [];
    list.push(e);
    edgesByGap.set(e.fromCol, list);
  }

  return (
    <div className="heroChainH">
      <div
        ref={scrollRef}
        className="heroChainH-scroll"
        tabIndex={0}
        aria-label="Chain from the first atoms to a smartphone. Scroll horizontally to explore."
      >
        <div
          className="heroChainH-track"
          ref={trackRef}
          style={{ ["--trackH" as string]: `${TRACK_H}px` } as React.CSSProperties}
          key={`pass-${pass}`}
        >
          {flat.columns.map((col, ci) => {
            const gap = edgesByGap.get(ci);
            const toColIdx = ci + 1;
            const toCol = flat.columns[toColIdx];
            const era = flat.eras[toColIdx];
            const colSeen = ci <= revealedUpTo;
            const arrowSeen = toColIdx <= revealedUpTo;

            return (
              <div key={`seg-${ci}`} className="heroChainH-seg">
                <Column
                  column={col}
                  seen={colSeen}
                  colRef={(node) => {
                    columnRefs.current[ci] = node;
                  }}
                />
                {gap && toCol && (
                  <Arrow
                    edges={gap}
                    fromSize={col.items.length}
                    toSize={toCol.items.length}
                    era={era}
                    pass={pass}
                    keyBase={`gap-${ci}`}
                    seen={arrowSeen}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="heroChainH-edgeL" aria-hidden="true" />
      <div className="heroChainH-edgeR" aria-hidden="true" />

      <div className="heroChainH-controls">
        <button
          type="button"
          className="heroChainH-replay"
          onClick={replay}
          data-ready={!playing ? "" : undefined}
          aria-label="Replay the animation"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M 2 8 A 6 6 0 1 1 8 14 M 2 8 L 5 5 M 2 8 L 5 11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Replay</span>
        </button>
      </div>

      <span className="sr-only">
        {stages
          .map(
            (s) =>
              s.inputs.map((i) => i.name).join(" and ") +
              " become " +
              s.final.name,
          )
          .join("; ") + "."}
      </span>
    </div>
  );
}

function Column({
  column,
  seen,
  colRef,
}: {
  column: Column;
  seen: boolean;
  colRef: (node: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={colRef}
      className={`heroChainH-col${column.isFinal ? " is-final" : ""}${
        column.isFinale ? " is-finale" : ""
      }${seen ? " is-seen" : ""}`}
      style={{
        ["--pitch" as string]: `${SLOT_H}px`,
        ["--n" as string]: column.items.length,
      } as React.CSSProperties}
    >
      {column.items.map((it, idx) => (
        <span
          key={it.key}
          className={`heroChainH-slot${it.isFinal ? " is-final" : ""}${
            it.isFinale ? " is-finale" : ""
          }`}
          style={{ ["--i" as string]: idx } as React.CSSProperties}
        >
          <TreeTile item={it.item} />
        </span>
      ))}
    </div>
  );
}

function Arrow({
  edges,
  fromSize,
  toSize,
  era,
  pass,
  keyBase,
  seen,
}: {
  edges: Edge[];
  fromSize: number;
  toSize: number;
  era?: string;
  pass: number;
  keyBase: string;
  seen: boolean;
}) {
  const byTarget = new Map<number, Edge[]>();
  const bySource = new Map<number, Edge[]>();
  for (const e of edges) {
    const bt = byTarget.get(e.toSlot) ?? [];
    bt.push(e);
    byTarget.set(e.toSlot, bt);
    const bs = bySource.get(e.fromSlot) ?? [];
    bs.push(e);
    bySource.set(e.fromSlot, bs);
  }

  const fromPitch = SLOT_H;
  const toPitch = SLOT_H;
  const W = GAP_W;
  const trunkX = Math.round(W * TRUNK_X);

  type Shape =
    | { kind: "convergence"; sourcesY: number[]; targetY: number; key: string }
    | { kind: "fanout"; sourceY: number; targetsY: number[]; key: string }
    | { kind: "direct"; sourceY: number; targetY: number; key: string };

  const shapes: Shape[] = [];
  const consumed = new Set<string>();

  for (const [tSlot, es] of byTarget) {
    if (es.length < 2) continue;
    const sourcesY = es.map((e) => slotY(e.fromSlot, fromSize, fromPitch));
    const targetY = slotY(tSlot, toSize, toPitch);
    shapes.push({ kind: "convergence", sourcesY, targetY, key: `${keyBase}-conv-${tSlot}` });
    for (const e of es) consumed.add(`${e.fromSlot}->${e.toSlot}`);
  }
  for (const [sSlot, es] of bySource) {
    const rest = es.filter((e) => !consumed.has(`${e.fromSlot}->${e.toSlot}`));
    if (rest.length < 2) continue;
    const sourceY = slotY(sSlot, fromSize, fromPitch);
    const targetsY = rest.map((e) => slotY(e.toSlot, toSize, toPitch));
    shapes.push({ kind: "fanout", sourceY, targetsY, key: `${keyBase}-fan-${sSlot}` });
    for (const e of rest) consumed.add(`${e.fromSlot}->${e.toSlot}`);
  }
  for (const e of edges) {
    if (consumed.has(`${e.fromSlot}->${e.toSlot}`)) continue;
    shapes.push({
      kind: "direct",
      sourceY: slotY(e.fromSlot, fromSize, fromPitch),
      targetY: slotY(e.toSlot, toSize, toPitch),
      key: `${keyBase}-dir-${e.fromSlot}-${e.toSlot}`,
    });
  }

  const markerId = `heroChainH-head-${keyBase}-${pass}`;

  return (
    <div className={`heroChainH-arrow${seen ? " is-seen" : ""}`}>
      {era && <span className="heroChainH-era">{era}</span>}
      <svg
        className="heroChainH-converge"
        viewBox={`0 0 ${W} ${TRACK_H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
          </marker>
        </defs>
        {shapes.map((s) => {
          if (s.kind === "direct") {
            // Orthogonal 1→1: horizontal stub, vertical, horizontal to target.
            const d = buildOrthogonalPath(s.sourceY, s.targetY, trunkX, W);
            return (
              <path
                key={s.key}
                className="heroChainH-beam"
                d={d}
                markerEnd={`url(#${markerId})`}
              />
            );
          }
          if (s.kind === "convergence") {
            // Each source: horizontal to trunkX, at the source's y.
            // One vertical trunk covering all source ys + target y.
            // One horizontal from (trunkX, targetY) to (W, targetY) with arrowhead.
            const ymin = Math.min(...s.sourcesY, s.targetY);
            const ymax = Math.max(...s.sourcesY, s.targetY);
            return (
              <g key={s.key}>
                {s.sourcesY.map((y, i) => (
                  <path
                    key={`${s.key}-sr-${i}`}
                    className="heroChainH-beam"
                    d={`M 0 ${y} L ${trunkX} ${y}`}
                  />
                ))}
                <path
                  className="heroChainH-beam"
                  d={`M ${trunkX} ${ymin} L ${trunkX} ${ymax}`}
                />
                <path
                  className="heroChainH-beam"
                  d={`M ${trunkX} ${s.targetY} L ${W} ${s.targetY}`}
                  markerEnd={`url(#${markerId})`}
                />
              </g>
            );
          }
          // fanout
          const ymin = Math.min(...s.targetsY, s.sourceY);
          const ymax = Math.max(...s.targetsY, s.sourceY);
          return (
            <g key={s.key}>
              <path
                className="heroChainH-beam"
                d={`M 0 ${s.sourceY} L ${trunkX} ${s.sourceY}`}
              />
              <path
                className="heroChainH-beam"
                d={`M ${trunkX} ${ymin} L ${trunkX} ${ymax}`}
              />
              {s.targetsY.map((y, i) => (
                <path
                  key={`${s.key}-tg-${i}`}
                  className="heroChainH-beam"
                  d={`M ${trunkX} ${y} L ${W} ${y}`}
                  markerEnd={`url(#${markerId})`}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Orthogonal path from (0, y1) to (W, y2) via a vertical jog at trunkX.
 * If y1 === y2, produces a single horizontal line.
 */
function buildOrthogonalPath(y1: number, y2: number, trunkX: number, W: number): string {
  if (Math.abs(y1 - y2) < 0.5) return `M 0 ${y1} L ${W} ${y1}`;
  return `M 0 ${y1} L ${trunkX} ${y1} L ${trunkX} ${y2} L ${W} ${y2}`;
}

function toCombineItem(t: TreeItem): CombineItem {
  return {
    id: t.slug,
    slug: t.slug,
    name: t.name,
    tier: t.tier,
    symbol: t.symbol,
    kind: t.kind,
    fact: "",
  };
}

function TreeTile({ item }: { item: TreeItem }) {
  return (
    <CombineTile item={toCombineItem(item)} variant="tray" label as="span" />
  );
}
