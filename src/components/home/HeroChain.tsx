"use client";

import { useEffect, useState } from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { ItemKind, Tier } from "@/db/schema";

export interface TreeItem {
  slug: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  symbol: string | null;
  pictogram: string | null;
}

/** One branch of the tree: an optional raw source becoming an intermediate
 *  item that feeds into the final. `raw` is nullable so branches can be
 *  one-level (e.g. water directly in lemonade). */
export interface TreeBranch {
  raw: TreeItem | null;
  mid: TreeItem;
}

export interface Tree {
  /** Stable id used in keys so React remounts between loops cleanly. */
  id: string;
  /** Final item slug — the "Explore" CTA deep-links here. */
  endSlug: string;
  branches: TreeBranch[];
  final: TreeItem;
}

const LOOP_MS = 8400;

/**
 * Hero animation. A branching tree assembles itself over ~6s, holds for
 * ~2s, then the component cycles into the next tree. Every tree shows:
 *   - a row of raw inputs (top)
 *   - a row of intermediates they transform into (middle)
 *   - the final item converging from all branches (bottom)
 *
 * The animation plays out column-by-column (left → right at each level)
 * then levels fade in top → bottom so the viewer reads it as "these things
 * become those things become this thing."
 */
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
      {/* Keyed remount restarts every keyframe from 0 on each cycle. */}
      <div
        key={tree.id}
        className="heroTree-run"
        style={{ "--cols": cols } as React.CSSProperties}
      >
        <span className="heroTree-spark" />

        {/* Raw inputs row */}
        <div className="heroTree-row heroTree-row-raw">
          {branches.map((b, i) => (
            <div key={`raw-${i}`} className="heroTree-cell">
              {b.raw && (
                <TreeNode
                  item={b.raw}
                  delay={`${i * 0.28}s`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Connectors raw → mid */}
        <div className="heroTree-connectors heroTree-connectors-rm">
          {branches.map((b, i) => (
            <span
              key={`crm-${i}`}
              className={`heroTree-connector${b.raw ? "" : " is-hidden"}`}
              style={{ animationDelay: `calc(${i * 0.28}s + 0.45s)` }}
            />
          ))}
        </div>

        {/* Mid row */}
        <div className="heroTree-row heroTree-row-mid">
          {branches.map((b, i) => (
            <div key={`mid-${i}`} className="heroTree-cell">
              <TreeNode
                item={b.mid}
                delay={`calc(${i * 0.28}s + 0.75s)`}
              />
            </div>
          ))}
        </div>

        {/* Connectors mid → final (converging) */}
        <div className="heroTree-connectors heroTree-connectors-mf">
          {branches.map((_, i) => (
            <span
              key={`cmf-${i}`}
              className="heroTree-connector heroTree-connector-converge"
              style={{
                animationDelay: `calc(${cols * 0.28}s + 1.2s + ${i * 0.08}s)`,
                // Offset expressed as "which column am I" minus the center
                // column, so the connector tilts toward the middle of the row.
                "--i": i - (cols - 1) / 2,
              } as React.CSSProperties}
            />
          ))}
        </div>

        {/* Final item */}
        <div className="heroTree-row heroTree-row-final">
          <div className="heroTree-cell heroTree-final-cell">
            <TreeNode
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

function TreeNode({
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
      className={`heroTree-item${isFinal ? " is-final" : ""}`}
      style={{ animationDelay: delay }}
    >
      <Pictogram
        name={item.name}
        tier={item.tier}
        kind={item.kind}
        symbol={item.symbol}
        pictogram={item.pictogram}
        size={isFinal ? 72 : 52}
      />
      <span className="heroTree-label">{item.name}</span>
    </span>
  );
}
