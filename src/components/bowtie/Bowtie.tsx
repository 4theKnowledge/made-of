"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { Pictogram } from "@/pictograms/Pictogram";
import { TIER, KIND } from "@/lib/taxonomy";
import { REL, RORDER } from "@/lib/rel";
import { formatFirstAppeared } from "@/lib/year";
import type { Confidence, LinkType, Tier } from "@/db/schema";
import type { ExploreEdge } from "@/components/explore/types";
import type { BowtieViewProps } from "./types";
import { EMPTY_MARKERS } from "./types";
import { drawWires, type WireChipInfo } from "./wires";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { ChipTip } from "./ChipTip";

/**
 * The shared bowtie: left column (inputs), focus card, right column
 * (outputs), SVG wires between them. Used by both Explore and Daily.
 *
 * - Explore: chips are <Link href="/explore/<slug>">; evidence dots open the drawer.
 * - Daily: chips are <button>s that call onChipClick; .target / .closed / .hint
 *   classes come from `daily` markers.
 */

const TIER_FILL: Record<Tier, string> = {
  F: "var(--fF)",
  N: "var(--fN)",
  M: "var(--fM)",
  C: "var(--fC)",
  P: "var(--fP)",
  S: "var(--fS)",
};

const CONF_VAR: Record<Confidence, string> = {
  established: "--good",
  strong: "--tC",
  debated: "--warn",
  hypothesis: "--bad",
};

export function Bowtie({ view, mode, daily, onChipClick }: BowtieViewProps) {
  const markers = daily ?? EMPTY_MARKERS;
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(
    view.recipes[0]?.id ?? null,
  );
  // Per-group fold state: key `${side}:${type}` -> expanded (true/false).
  // Reset when the focus item changes.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpandedGroups(new Set());
  }, [view.item.slug]);

  const [evidenceState, setEvidenceState] = useState<{
    linkCode: string | null;
    direction: "up" | "down";
    type: LinkType | null;
    fromName: string | null;
    toName: string | null;
  }>({
    linkCode: null,
    direction: "up",
    type: null,
    fromName: null,
    toName: null,
  });

  // Reset recipe when the focus item changes.
  useEffect(() => {
    setSelectedRecipeId(view.recipes[0]?.id ?? null);
  }, [view.item.slug, view.recipes]);

  const upVisible = useMemo(() => {
    if (view.recipes.length <= 1) return view.up;
    return view.up.filter(
      (e) => e.recipeId === selectedRecipeId || e.recipeId === null,
    );
  }, [view.recipes.length, view.up, selectedRecipeId]);

  const upByType = useMemo(() => groupByType(upVisible), [upVisible]);
  const downByType = useMemo(() => groupByType(view.down), [view.down]);

  const yr = formatFirstAppeared(view.item.firstAppeared);

  /* ---------- Wires ---------- */

  const stageRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useRef<HTMLDivElement | null>(null);
  const wiresRef = useRef<SVGSVGElement | null>(null);
  const upColRef = useRef<HTMLDivElement | null>(null);
  const downColRef = useRef<HTMLDivElement | null>(null);
  const [wiresTick, setWiresTick] = useState(0);

  const redrawWires = useCallback(() => {
    const stage = stageRef.current;
    const focus = focusRef.current;
    const wires = wiresRef.current;
    if (!stage || !focus || !wires) return;

    const chips: WireChipInfo[] = [];
    const collect = (col: HTMLElement | null, side: "up" | "down") => {
      if (!col) return;
      const nodes = col.querySelectorAll<HTMLElement>(".chip[data-k]");
      nodes.forEach((el) => {
        const dataKey = el.dataset.k ?? "";
        const type = (el.dataset.type ?? "") as LinkType;
        if (!type) return;
        const weak = el.dataset.weak === "1";
        chips.push({ el, side, type, weak, dataKey });
      });
    };
    collect(upColRef.current, "up");
    collect(downColRef.current, "down");
    drawWires(stage, focus, wires, chips);
  }, []);

  useLayoutEffect(() => {
    redrawWires();
  }, [
    redrawWires,
    upByType,
    downByType,
    selectedRecipeId,
    wiresTick,
    view.item.slug,
    expandedGroups,
  ]);

  useEffect(() => {
    const onResize = () => setWiresTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    // Re-measure after fonts load (chip widths shift).
    if (document.fonts && "ready" in document.fonts) {
      document.fonts.ready.then(() => setWiresTick((t) => t + 1));
    }
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ---------- Hover state ---------- */

  // Edge lookup keyed by `${side}:${type}:${slug}` so chip hover can find
  // the matching edge without re-scanning props. Rebuilt on view change.
  const edgeByKey = useMemo(() => {
    const map = new Map<string, { edge: ExploreEdge; dir: "up" | "down" }>();
    for (const e of view.up) {
      map.set(`up:${e.type}:${e.item.slug}`, { edge: e, dir: "up" });
    }
    for (const e of view.down) {
      map.set(`down:${e.type}:${e.item.slug}`, { edge: e, dir: "down" });
    }
    return map;
  }, [view.up, view.down]);

  const [hovered, setHovered] = useState<{
    edge: ExploreEdge;
    dir: "up" | "down";
  } | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

  const onStageMouseOver = useCallback(
    (e: React.MouseEvent | React.FocusEvent) => {
      const target = e.target as HTMLElement;
      const chip = target.closest<HTMLElement>(".chip[data-k]");
      const wires = wiresRef.current;
      if (!chip) {
        wires?.classList.remove("dim");
        wires
          ?.querySelectorAll<SVGPathElement>("path.hot")
          .forEach((p) => p.classList.remove("hot"));
        setHovered(null);
        return;
      }
      const side = chip.closest(".up") ? "up" : "down";
      wires?.classList.add("dim");
      const wireKey = side + (chip.dataset.k ?? "");
      wires
        ?.querySelectorAll<SVGPathElement>("path")
        .forEach((p) => p.classList.toggle("hot", p.dataset.k === wireKey));

      // Resolve the hovered edge for the tooltip.
      const dataKey = chip.dataset.k ?? "";
      const found = edgeByKey.get(`${side}:${dataKey}`);
      if (found) setHovered(found);
      if ("clientX" in e) {
        setMouse({ x: e.clientX, y: e.clientY });
      }
    },
    [edgeByKey],
  );

  const onStageMouseMove = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const chip = target.closest<HTMLElement>(".chip[data-k]");
    if (!chip) return;
    setMouse({ x: e.clientX, y: e.clientY });
  }, []);

  const onStageMouseLeave = useCallback(() => {
    const wires = wiresRef.current;
    wires?.classList.remove("dim");
    wires
      ?.querySelectorAll<SVGPathElement>("path.hot")
      .forEach((p) => p.classList.remove("hot"));
    setHovered(null);
    setMouse(null);
  }, []);

  // Scrolling should dismiss the tip (prototype does this too).
  useEffect(() => {
    const onScroll = () => {
      setHovered(null);
      setMouse(null);
    };
    document.addEventListener("scroll", onScroll, { passive: true });
    return () => document.removeEventListener("scroll", onScroll);
  }, []);

  /* ---------- Chip renderer ---------- */

  const openEvidence = (edge: ExploreEdge, direction: "up" | "down") => {
    setEvidenceState({
      linkCode: edge.linkCode,
      direction,
      type: edge.type,
      fromName: direction === "up" ? edge.item.name : view.item.name,
      toName: direction === "up" ? view.item.name : edge.item.name,
    });
  };

  const chipDataKey = (edge: ExploreEdge) => `${edge.type}:${edge.item.slug}`;

  const renderSideChip = (edge: ExploreEdge, dir: "up" | "down", i: number) => {
    const closed = markers.closedCodes.has(edge.item.code);
    const target = markers.goalCode === edge.item.code;
    const hint = markers.hintCodes.has(edge.item.code);
    const weak =
      edge.confidence === "debated" || edge.confidence === "hypothesis";

    const chipClasses = [
      "chip",
      closed ? "closed" : "",
      target ? "target" : "",
      hint ? "hint" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const chipStyle = {
      "--c": `var(--t${edge.item.tier})`,
      "--i": i,
    } as React.CSSProperties;

    const inner = (
      <>
        <Pictogram
          name={edge.item.name}
          tier={edge.item.tier}
          kind={edge.item.kind}
          symbol={edge.item.symbol}
        />
        <span className="nm">{edge.item.name}</span>
      </>
    );

    const commonProps = {
      className: chipClasses,
      style: chipStyle,
      "data-k": chipDataKey(edge),
      "data-type": edge.type,
      "data-weak": weak ? "1" : undefined,
    };

    const chipEl =
      mode === "daily" ? (
        <button
          key={edge.linkCode}
          type="button"
          {...commonProps}
          onClick={(e) =>
            onChipClick?.(edge.item.code, e.currentTarget as HTMLElement)
          }
          disabled={closed}
          aria-disabled={closed}
        >
          {inner}
        </button>
      ) : (
        <Link
          key={edge.linkCode}
          href={`/explore/${edge.item.slug}`}
          prefetch={false}
          {...commonProps}
          onClick={(e) => {
            if (!onChipClick) return;
            // Progressive enhancement: the <a href> works without JS.
            // With JS we intercept to animate + swap in place.
            if (
              e.defaultPrevented ||
              e.metaKey ||
              e.ctrlKey ||
              e.shiftKey ||
              e.altKey ||
              (e.button !== undefined && e.button !== 0)
            )
              return;
            e.preventDefault();
            onChipClick(edge.item.code, e.currentTarget as HTMLElement);
          }}
        >
          {inner}
        </Link>
      );

    if (!edge.hasEvidence) return chipEl;

    const dot = (
      <button
        key="dot"
        type="button"
        className="evb"
        data-c={edge.confidence}
        style={{ "--cc": `var(${CONF_VAR[edge.confidence]})` } as React.CSSProperties}
        title={`Evidence: ${edge.confidence}`}
        aria-label={`Evidence for this link: ${edge.confidence}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openEvidence(edge, dir);
        }}
      />
    );

    return (
      <span className="lk" key={edge.linkCode}>
        {dir === "up" ? dot : null}
        {chipEl}
        {dir === "down" ? dot : null}
      </span>
    );
  };

  /* ---------- Render ---------- */

  const [stageAnim, setStageAnim] = useState<string>("");
  useEffect(() => {
    // Restart entry animation on every focus change.
    setStageAnim("");
    const id = requestAnimationFrame(() => setStageAnim("enter"));
    return () => cancelAnimationFrame(id);
  }, [view.item.slug]);

  return (
    <>
      <div className="stagehead">
        <div>← What it takes</div>
        <div />
        <div>What it leads to →</div>
      </div>

      <section
        ref={stageRef}
        className={`stage${stageAnim ? ` ${stageAnim}` : ""}`}
        style={{ "--fill": TIER_FILL[view.item.tier] } as React.CSSProperties}
        onMouseOver={onStageMouseOver}
        onMouseMove={onStageMouseMove}
        onFocus={onStageMouseOver}
        onMouseLeave={onStageMouseLeave}
      >
        <svg className="wires" ref={wiresRef} aria-hidden="true" />
        <div className="col up" ref={upColRef}>
          {view.recipes.length > 1 ? (
            <div className="recipes">
              <span className="rl">
                {view.recipes.length} ways to make it
              </span>
              <div className="seg" role="group" aria-label="Recipe">
                {view.recipes.map((r, i) => (
                  <button
                    key={r.id}
                    type="button"
                    className={r.id === selectedRecipeId ? "on" : ""}
                    aria-pressed={r.id === selectedRecipeId}
                    onClick={() => setSelectedRecipeId(r.id)}
                  >
                    {r.label ?? `Way ${i + 1}`}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {upByType.size === 0 ? (
            <p className="empty">
              Nothing comes before this. As far as physics can tell, this is
              where it starts.
            </p>
          ) : (
            renderGroupsWithStagger(
              [...upByType.entries()],
              "up",
              expandedGroups,
              (type) =>
                setExpandedGroups((s) => new Set(s).add(`up:${type}`)),
              renderSideChip,
            )
          )}
        </div>

        <article
          ref={focusRef}
          className="focus"
          aria-live="polite"
          style={{ "--c": `var(--t${view.item.tier})` } as React.CSSProperties}
        >
          <div className="stats">
            <div className="stat">
              <b>{view.stepsFromBigBang ?? "—"}</b>
              <span>
                {view.stepsFromBigBang === 0
                  ? "this is the start"
                  : "steps from the big bang"}
              </span>
            </div>
            <div className="stat">
              <b>{view.ancestorCount}</b>
              <span>things can go into it</span>
            </div>
          </div>
          <div className="fhead">
            <div className="fpic">
              <Pictogram
                name={view.item.name}
                tier={view.item.tier}
                kind={view.item.kind}
                symbol={view.item.symbol}
              />
              {view.item.kind !== "element" && view.item.symbol ? (
                <span className="fsym" aria-hidden="true">
                  {view.item.symbol}
                </span>
              ) : null}
            </div>
            <h2>{view.item.name}</h2>
            <div className="tierline">
              <span className="pills">
                <span className="pill t">{TIER[view.item.tier].name}</span>
                <span className="pill">{KIND[view.item.kind]}</span>
              </span>
            </div>
          </div>
          <div className="fmore">
            {view.item.fact ? <p className="fact">{view.item.fact}</p> : null}
            <div className="when">
              <div className="wl">
                <span>First appeared</span>
                {yr ? (
                  <b>{yr.label}</b>
                ) : (
                  <b className="unknown">Date not yet known</b>
                )}
              </div>
            </div>
          </div>
        </article>

        <div className="col down" ref={downColRef}>
          {downByType.size === 0 ? (
            <p className="empty">Nothing on this map is built from it yet.</p>
          ) : (
            renderGroupsWithStagger(
              [...downByType.entries()],
              "down",
              expandedGroups,
              (type) =>
                setExpandedGroups((s) => new Set(s).add(`down:${type}`)),
              renderSideChip,
            )
          )}
        </div>

        {/* Phone-only duplicate of the fact under the bowtie. */}
        <div
          className="fdetail"
          style={{ "--c": `var(--t${view.item.tier})` } as React.CSSProperties}
        >
          {view.item.fact ? <p className="fact">{view.item.fact}</p> : null}
        </div>
      </section>

      <EvidenceDrawer
        linkCode={evidenceState.linkCode}
        direction={evidenceState.direction}
        type={evidenceState.type}
        fromName={evidenceState.fromName}
        toName={evidenceState.toName}
        onClose={() =>
          setEvidenceState((s) => ({ ...s, linkCode: null, type: null }))
        }
      />

      <ChipTip
        edge={hovered?.edge ?? null}
        dir={hovered?.dir ?? "up"}
        closedInPuzzles={
          mode === "daily" && hovered
            ? markers.closedCodes.has(hovered.edge.item.code)
            : false
        }
        mouse={mouse}
      />
    </>
  );
}

function groupByType(edges: ExploreEdge[]): Map<LinkType, ExploreEdge[]> {
  const out = new Map<LinkType, ExploreEdge[]>();
  for (const t of RORDER) out.set(t, []);
  for (const e of edges) {
    const bucket = out.get(e.type);
    if (bucket) bucket.push(e);
  }
  const tierOrder = ["F", "N", "M", "C", "P", "S"];
  for (const [, bucket] of out) {
    bucket.sort((a, b) => {
      const ta = tierOrder.indexOf(a.item.tier);
      const tb = tierOrder.indexOf(b.item.tier);
      if (ta !== tb) return ta - tb;
      return a.item.name.localeCompare(b.item.name);
    });
  }
  for (const [k, bucket] of [...out.entries()]) {
    if (bucket.length === 0) out.delete(k);
  }
  return out;
}

/**
 * Render all groups in a column while sharing one stagger counter across
 * groups. This keeps the entry animation flowing (chip in group B's delay
 * continues from where group A left off) exactly as the prototype does.
 */
function renderGroupsWithStagger(
  entries: Array<[LinkType, ExploreEdge[]]>,
  dir: "up" | "down",
  expandedGroups: Set<string>,
  onExpand: (type: LinkType) => void,
  renderChip: (edge: ExploreEdge, dir: "up" | "down", i: number) => React.ReactNode,
): React.ReactNode[] {
  let counter = 0;
  return entries.map(([type, edges]) => {
    const start = counter;
    counter += edges.length;
    return (
      <ChipGroup
        key={type}
        type={type}
        edges={edges}
        dir={dir}
        startIndex={start}
        expanded={expandedGroups.has(`${dir}:${type}`)}
        onExpand={() => onExpand(type)}
        renderChip={renderChip}
      />
    );
  });
}

/**
 * One group of chips for a single relation type ("Made from", "Needs", …).
 * Folds to the first LIMIT items when there are more than LIMIT+2 total,
 * showing a "+N more" button that expands the full list.
 *
 * Breakpoints match the prototype: phone (max-width 600px) uses LIMIT=5,
 * wider uses LIMIT=9.
 */
function ChipGroup({
  type,
  edges,
  dir,
  startIndex,
  expanded,
  onExpand,
  renderChip,
}: {
  type: LinkType;
  edges: ExploreEdge[];
  dir: "up" | "down";
  startIndex: number;
  expanded: boolean;
  onExpand: () => void;
  renderChip: (edge: ExploreEdge, dir: "up" | "down", i: number) => React.ReactNode;
}) {
  // Match the prototype's matchMedia check. useSyncExternalStore-free: just
  // measure on mount + listen for changes.
  const [limit, setLimit] = useState(9);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 600px)");
    const apply = () => setLimit(mq.matches ? 5 : 9);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const shouldFold = !expanded && edges.length > limit + 2;
  const shown = shouldFold ? edges.slice(0, limit) : edges;

  return (
    <div className="group">
      <div className="glabel">
        {dir === "up" ? (
          <>
            {REL[type].up} <RelLine type={type} />
          </>
        ) : (
          <>
            <RelLine type={type} /> {REL[type].down}
          </>
        )}
      </div>
      <div className="chips">
        {shown.map((e, i) => renderChip(e, dir, startIndex + i))}
      </div>
      {shouldFold ? (
        <button type="button" className="more" onClick={onExpand}>
          + {edges.length - shown.length} more
        </button>
      ) : null}
    </div>
  );
}

function RelLine({ type }: { type: LinkType }) {
  const dash = REL[type].dash;
  return (
    <svg
      width="26"
      height="8"
      aria-hidden="true"
      style={{ color: "var(--muted)", flex: "none" }}
    >
      <path
        d="M1 4h24"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray={dash || undefined}
      />
    </svg>
  );
}
