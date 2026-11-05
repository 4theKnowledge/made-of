"use client";

import { useEffect, useState } from "react";
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

export interface TreeBranch {
  raw: TreeItem | null;
  mid: TreeItem;
}

export interface Tree {
  id: string;
  endSlug: string;
  branches: TreeBranch[];
  final: TreeItem;
}

const LOOP_MS = 8400;

export function HeroChain({ trees }: { trees: Tree[] }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (trees.length <= 1) return;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % trees.length);
    }, LOOP_MS);
    return () => clearInterval(t);
  }, [trees.length]);

  const tree = trees[idx];
  if (!tree) return null;

  const { branches, final } = tree;
  const cols = branches.length;

  return (
    <div className="heroTree" aria-hidden="true">
      <div
        key={tree.id}
        className="heroTree-run"
        style={{ "--cols": cols } as React.CSSProperties}
      >
        <span className="heroTree-spark" />

        <div className="heroTree-row heroTree-row-raw">
          {branches.map((b, i) => (
            <div key={`raw-${i}`} className="heroTree-cell">
              {b.raw && <TreeTile item={b.raw} delay={`${i * 0.28}s`} />}
            </div>
          ))}
        </div>

        <div className="heroTree-connectors heroTree-connectors-rm">
          {branches.map((b, i) => (
            <span
              key={`crm-${i}`}
              className={`heroTree-connector${b.raw ? "" : " is-hidden"}`}
              style={{ animationDelay: `calc(${i * 0.28}s + 0.45s)` }}
            />
          ))}
        </div>

        <div className="heroTree-row heroTree-row-mid">
          {branches.map((b, i) => (
            <div key={`mid-${i}`} className="heroTree-cell">
              <TreeTile item={b.mid} delay={`calc(${i * 0.28}s + 0.75s)`} />
            </div>
          ))}
        </div>

        {/* Mid → final converging lines. SVG so lines actually reach the
            final tile regardless of column count. preserveAspect=none lets
            the X-axis stretch with the grid cell. */}
        <svg
          className="heroTree-converge"
          viewBox={`0 0 ${cols * 100} 44`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {branches.map((_, i) => {
            const x1 = (i + 0.5) * 100;
            const x2 = (cols * 100) / 2;
            return (
              <line
                key={`cmf-${i}`}
                x1={x1}
                y1={0}
                x2={x2}
                y2={44}
                style={{
                  animationDelay: `calc(${cols * 0.28}s + 1.2s + ${i * 0.08}s)`,
                }}
              />
            );
          })}
        </svg>

        <div className="heroTree-row heroTree-row-final">
          <div className="heroTree-cell heroTree-final-cell">
            <TreeTile
              item={final}
              delay={`calc(${cols * 0.28}s + 1.9s)`}
              isFinal
            />
          </div>
        </div>
      </div>

      <span className="sr-only">
        {branches
          .map((b) => (b.raw ? `${b.raw.name} to ${b.mid.name}` : b.mid.name))
          .join(", ") + ` to ${final.name}`}
      </span>
    </div>
  );
}

/** Adapt a TreeItem to the CombineItem shape CombineTile expects. Only the
 *  fields the tray variant reads (name, tier, kind, symbol) need to be real;
 *  the rest are harmless stubs so TS is happy. */
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
  isFinal,
}: {
  item: TreeItem;
  delay: string;
  isFinal?: boolean;
}) {
  return (
    <span
      className={`heroTree-slot${isFinal ? " is-final" : ""}`}
      style={{ animationDelay: delay }}
    >
      <CombineTile
        item={toCombineItem(item)}
        variant="tray"
        label
        as="span"
      />
    </span>
  );
}
