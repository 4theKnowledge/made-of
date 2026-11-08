"use client";

import React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";

/**
 * Shared manifest tile grid (T-0244). Used by three surfaces:
 *
 *   - Start-daily sheet (`CombineBoard`): preview of today's find list
 *     before the clock starts. All tiles render unfound.
 *   - JourneySheet daily branch: in-run review. Found items dim but
 *     keep tier colour so the eye is pulled to what's left.
 *   - GameOverCard: end-of-run summary. `endMode` dims missed tiles
 *     and marks them with ✗; found tiles get ✓.
 *
 * Tap on any tile fires `onInfo(id)` → caller opens DetailCard. Tiles
 * without a resolved bundle entry fall back to a placeholder so an
 * admin content drift doesn't break the render.
 */
export function ManifestGrid({
  manifest,
  manifestFound,
  bundle,
  mode = "progress",
  onInfo,
}: {
  manifest: string[];
  /** Subset of `manifest` the player has made. Checked for dimming +
   *  check-glyph overlay. Pass `[]` for the pre-run "all unfound"
   *  preview rendered in the start sheet. */
  manifestFound: string[];
  bundle: ThemeBundle;
  /** `progress` — in-run / start-of-run. Found items dim but keep
   *    colour, unfound stay vivid.
   *  `end` — post-run summary. Found get ✓, missed render muted + ✗.
   *    Used on the GameOverCard. */
  mode?: "progress" | "end";
  onInfo?: (id: string) => void;
}) {
  const foundSet = new Set(manifestFound);
  return (
    <div className="cbmanifest" role="list" aria-label="Today's find list">
      {manifest.map((id) => {
        const it = bundle.items.get(id);
        const found = foundSet.has(id);
        const clickable = !!(onInfo && it);
        const stateClass = found
          ? " cbmanifest-tile-found"
          : mode === "end"
            ? " cbmanifest-tile-missed"
            : "";
        const label = it ? cap(it.name) : id;
        const title =
          mode === "end"
            ? `${label} · ${found ? "found" : "missed"}`
            : `${label} · ${found ? "found" : "to find"}`;
        const inner = it ? (
          <>
            <Pictogram
              name={it.name}
              tier={it.tier}
              kind={it.kind}
              symbol={it.symbol}
            />
            {found && (
              <span className="cbmanifest-check" aria-hidden="true">
                ✓
              </span>
            )}
            {!found && mode === "end" && (
              <span className="cbmanifest-cross" aria-hidden="true">
                ✗
              </span>
            )}
            <em className="cbmanifest-name">{label}</em>
          </>
        ) : (
          <em className="cbmanifest-name">{label}</em>
        );
        const baseClass = `cbmanifest-tile${stateClass}`;
        if (clickable) {
          return (
            <button
              key={id}
              type="button"
              role="listitem"
              className={baseClass}
              style={it ? fillVar(it) : undefined}
              title={title}
              aria-label={title}
              onClick={() => onInfo!(id)}
            >
              {inner}
            </button>
          );
        }
        return (
          <span
            key={id}
            role="listitem"
            className={baseClass}
            style={it ? fillVar(it) : undefined}
            title={title}
          >
            {inner}
          </span>
        );
      })}
    </div>
  );
}
