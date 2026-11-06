"use client";

import { useEffect, useRef, useState } from "react";
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

/**
 * One stage of the chain. Up to three inputs converge into one `final`.
 * On non-first stages the first input is the previous stage's final — it
 * animates in from the position the previous final finished at.
 */
export interface ChainStage {
  id: string;
  era?: string;
  inputs: TreeItem[];
  final: TreeItem;
}

/* ---------- Timing (seconds) ----------
 * Each stage plays in-place inside the fixed-size container. One stage =
 * inputs-in → converge → final-pop → dwell → outro. The outro collapses
 * the non-carried inputs and translates the final tile up to the leftmost
 * input slot, becoming the carry for the next stage.
 */
const T = {
  inputStagger: 0.22,
  inputFade: 0.4,
  convergeDelay: 0.2,
  convergeDur: 0.5,
  finalDelay: 0.2,
  finalDur: 0.5,
  dwell: 0.7,
  outro: 0.6,
};

/** Pause on the finished smartphone before the chain auto-restarts. */
const LOOP_PAUSE_MS = 4500;

function stageDurationSec(nInputs: number): number {
  const inputsEnd = nInputs * T.inputStagger + T.inputFade;
  const converge = inputsEnd + T.convergeDelay + T.convergeDur;
  const final = converge + T.finalDelay + T.finalDur;
  return final + T.dwell + T.outro;
}

export function HeroChain({ stages }: { stages: ChainStage[] }) {
  const [idx, setIdx] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [finished, setFinished] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Depend only on primitives so re-renders with a new-reference `stages`
  // array don't tear down and restart the active timers.
  const nStages = stages.length;
  const curInputCount = stages[Math.min(idx, nStages - 1)]?.inputs.length ?? 0;

  useEffect(() => {
    if (nStages === 0 || idx >= nStages) {
      setFinished(true);
      return;
    }
    const isLast = idx + 1 >= nStages;
    const stageMs = stageDurationSec(curInputCount) * 1000;
    const durMs = isLast ? stageMs + LOOP_PAUSE_MS : stageMs;
    timerRef.current = setTimeout(() => {
      if (isLast) {
        setFinished(false);
        setIdx(0);
        setNonce((n) => n + 1);
      } else {
        setIdx(idx + 1);
      }
    }, durMs);
    // On the last stage, flip the "finished" flag early so the replay
    // button shows during the dwell, not only after the loop restart.
    let finishFlagTimer: ReturnType<typeof setTimeout> | null = null;
    if (isLast) {
      finishFlagTimer = setTimeout(() => setFinished(true), stageMs);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (finishFlagTimer) clearTimeout(finishFlagTimer);
    };
  }, [idx, nonce, nStages, curInputCount]);

  const replay = () => {
    setFinished(false);
    setIdx(0);
    setNonce((n) => n + 1);
  };

  if (stages.length === 0) return null;
  const stage = stages[Math.min(idx, stages.length - 1)];
  const cols = stage.inputs.length;
  const isFirst = idx === 0;
  const isLast = idx === stages.length - 1;

  // The final tile stays visible past its stage's dwell — we only animate
  // it to the carried-slot position when there's a next stage. On the last
  // stage it just stays glowing in the centre.
  const stageDone = finished && isLast;

  return (
    <div className="heroChain">
      <div
        key={`stage-${idx}-${nonce}`}
        className={`heroChain-stage${isFirst ? " is-first" : ""}${
          stageDone ? " is-done" : ""
        }`}
        data-cols={cols}
        style={{ "--cols": cols } as React.CSSProperties}
        aria-hidden="true"
      >
        {isFirst && <span className="heroChain-spark" />}

        {stage.era && <span className="heroChain-era">{stage.era}</span>}

        <div className="heroChain-inputs">
          {stage.inputs.map((item, i) => {
            const isCarry = !isFirst && i === 0;
            const delay = isCarry
              ? "0s"
              : `${i * T.inputStagger}s`;
            return (
              <div
                key={`${stage.id}-in-${i}`}
                className="heroChain-cell"
                style={{ "--col": i } as React.CSSProperties}
              >
                <TreeTile
                  item={item}
                  delay={delay}
                  variant={isCarry ? "carry" : "input"}
                />
              </div>
            );
          })}
        </div>

        <svg
          className="heroChain-converge"
          viewBox={`0 0 ${cols * 100} 72`}
          preserveAspectRatio="none"
        >
          {/* Funnel curves + travelling pulse. Each curve is a cubic
              bezier that drops straight from its input then bends inward
              to meet at the final tile centre. A circle rides each path
              via <animateMotion> so the energy visibly flows down. */}
          {stage.inputs.map((_, i) => {
            const inputsEnd = cols * T.inputStagger + T.inputFade;
            const convergeStart = inputsEnd + T.convergeDelay;
            const x1 = (i + 0.5) * 100;
            const xC = (cols * 100) / 2;
            const d = `M ${x1} 0 C ${x1} 36, ${xC} 42, ${xC} 72`;
            const pathId = `heroChainPath-${stage.id}-${i}`;
            return (
              <g key={`path-${i}`}>
                <path
                  id={pathId}
                  className="heroChain-beam"
                  d={d}
                  style={{
                    animationDelay: `${convergeStart + i * 0.04}s`,
                  }}
                />
                <circle className="heroChain-pulse" r="2.4" opacity="0">
                  <set
                    attributeName="opacity"
                    to="1"
                    begin={`${convergeStart + 0.15 + i * 0.04}s`}
                  />
                  <set
                    attributeName="opacity"
                    to="0"
                    begin={`${convergeStart + 0.15 + i * 0.04 + 0.55}s`}
                  />
                  <animateMotion
                    begin={`${convergeStart + 0.15 + i * 0.04}s`}
                    dur="0.55s"
                    fill="freeze"
                    rotate="auto"
                  >
                    <mpath href={`#${pathId}`} />
                  </animateMotion>
                </circle>
              </g>
            );
          })}
        </svg>

        <div className="heroChain-final">
          <TreeTile
            item={stage.final}
            delay={`${
              cols * T.inputStagger +
              T.inputFade +
              T.convergeDelay +
              T.convergeDur +
              T.finalDelay
            }s`}
            variant={isLast ? "finale" : "final"}
          />
        </div>
      </div>

      <div className="heroChain-controls">
        <button
          type="button"
          className="heroChain-replay"
          onClick={replay}
          data-ready={finished ? "" : undefined}
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

function TreeTile({
  item,
  delay,
  variant,
}: {
  item: TreeItem;
  delay: string;
  variant: "input" | "carry" | "final" | "finale";
}) {
  const cls =
    variant === "finale"
      ? "heroChain-slot is-final is-finale"
      : variant === "final"
        ? "heroChain-slot is-final"
        : variant === "carry"
          ? "heroChain-slot is-carry"
          : "heroChain-slot";
  return (
    <span
      className={cls}
      style={{
        animationDelay: delay,
        ["--delay" as string]: delay,
      } as React.CSSProperties}
    >
      <CombineTile item={toCombineItem(item)} variant="tray" label as="span" />
    </span>
  );
}
