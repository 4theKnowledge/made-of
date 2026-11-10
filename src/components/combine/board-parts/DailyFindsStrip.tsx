"use client";

import React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";

/**
 * Always-visible in-run manifest tracker for daily runs. Collapsed row
 * of mini pictogram chips, found items checked and dimmed. Tap anywhere
 * on the strip opens JourneySheet for the full ManifestGrid (`onOpen`).
 */
export function DailyFindsStrip({
  manifest,
  manifestFound,
  bundle,
  onOpen,
}: {
  manifest: string[];
  manifestFound: string[];
  bundle: ThemeBundle;
  onOpen: () => void;
}) {
  if (manifest.length === 0) return null;
  const foundSet = new Set(manifestFound);
  const foundN = foundSet.size;
  const total = manifest.length;
  const label = `Daily finds: ${foundN} of ${total}. Tap for details.`;
  return (
    <button
      type="button"
      className="cbfindsstrip"
      aria-label={label}
      onClick={onOpen}
    >
      <span className="cbfindsstrip-row">
        {manifest.map((id) => {
          const it = bundle.items.get(id);
          const found = foundSet.has(id);
          const title = it
            ? `${cap(it.name)} · ${found ? "found" : "to find"}`
            : id;
          return (
            <span
              key={id}
              className={`cbfindsstrip-chip${found ? " on" : ""}`}
              style={it ? fillVar(it) : undefined}
              title={title}
            >
              {it && (
                <Pictogram
                  name={it.name}
                  tier={it.tier}
                  kind={it.kind}
                  symbol={it.symbol}
                />
              )}
              {found && (
                <span className="cbfindsstrip-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </span>
          );
        })}
      </span>
    </button>
  );
}
