import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { GameState } from "@/combine/engine";
import { chapterIndex, chapterThreshold } from "@/combine/progression";
import type { CombineItem, ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";

/** Journey dialog. Two modes:
 *  - Daily: a fixed-target run, so chapter grouping is noise. Shows the
 *    goal + a flat list of this run's discoveries.
 *  - Endless/fast: chapter progression — "This chapter" always expanded,
 *    prior chapters collapsed with a ▸ toggle. */
export function JourneySheet({
  state,
  bundle,
  onInfo,
  onDismiss,
}: {
  state: GameState;
  bundle: ThemeBundle;
  onInfo: (id: string) => void;
  onDismiss: () => void;
}) {
  if (state.mode === "daily") {
    return (
      <DailyJourney
        state={state}
        bundle={bundle}
        onInfo={onInfo}
        onDismiss={onDismiss}
      />
    );
  }
  return (
    <ChapterJourney
      state={state}
      bundle={bundle}
      onInfo={onInfo}
      onDismiss={onDismiss}
    />
  );
}

function DailyJourney({
  state,
  bundle,
  onInfo,
  onDismiss,
}: {
  state: GameState;
  bundle: ThemeBundle;
  onInfo: (id: string) => void;
  onDismiss: () => void;
}) {
  const manifest = state.manifest ?? [];
  const foundCount = state.manifestFound.length;
  const total = manifest.length;
  // Items the player made that aren't on the manifest — tracked
  // separately so the player sees progress without the list turning
  // into noise. Rendered compactly below the grid.
  const extras = state.found.filter((id) => !manifest.includes(id));
  return (
    <ResponsiveSheet open onDismiss={onDismiss} ariaLabel="Journey" className="cbagesheet">
      <span className="k">Journey</span>
      {total > 0 ? (
        <>
          <h3>
            Daily — {foundCount} of {total} items found
          </h3>
          <p>
            {foundCount < total
              ? `${total - foundCount} to find · ${state.moves} turn${state.moves === 1 ? "" : "s"} so far. Fewer turns ranks higher.`
              : `Complete in ${state.moves} turn${state.moves === 1 ? "" : "s"}.`}
          </p>
          <ManifestRowList
            manifest={manifest}
            manifestFound={state.manifestFound}
            moves={state.moves}
            bundle={bundle}
            onInfo={onInfo}
          />
          {extras.length > 0 && (
            <>
              <p className="k" style={{ marginTop: 8 }}>
                Extra discoveries
              </p>
              <div className="cbagefinds" aria-label="Extra discoveries">
                {extras.map((id) => {
                  const it = bundle.items.get(id);
                  if (!it) return null;
                  return <DiscoveryTile key={id} item={it} onInfo={onInfo} />;
                })}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <h3>
            Daily — {state.found.length} discover{state.found.length === 1 ? "y" : "ies"} this run
          </h3>
          <p>
            {state.moves} turn{state.moves === 1 ? "" : "s"} so far. Fewer turns ranks higher on today&apos;s leaderboard.
          </p>
          {state.found.length > 0 && (
            <div className="cbagefinds" aria-label="Found this run">
              {state.found.map((id) => {
                const it = bundle.items.get(id);
                if (!it) return null;
                return <DiscoveryTile key={id} item={it} onInfo={onInfo} />;
              })}
            </div>
          )}
        </>
      )}
      <button type="button" className="cbh cbback" onClick={onDismiss}>
        Done
      </button>
    </ResponsiveSheet>
  );
}

function ChapterJourney({
  state,
  bundle,
  onInfo,
  onDismiss,
}: {
  state: GameState;
  bundle: ThemeBundle;
  onInfo: (id: string) => void;
  onDismiss: () => void;
}) {
  const foundCount = state.found.length;
  const currentChapter = chapterIndex(foundCount) + 1;
  const nextThreshold = chapterThreshold(currentChapter);
  const finite = Number.isFinite(nextThreshold);
  const left = finite ? Math.max(0, nextThreshold - foundCount) : 0;

  // Group discoveries by the chapter the player was in when they found
  // them. Chapter 0 is the graceful fallback for saves predating chapter
  // attribution — rendered as "Chapter —".
  const foundByChapter = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const id of state.found) {
      const ch = state.discoveredAtChapter?.[id] ?? 0;
      let list = m.get(ch);
      if (!list) {
        list = [];
        m.set(ch, list);
      }
      list.push(id);
    }
    return m;
  }, [state.found, state.discoveredAtChapter]);

  const [openChapters, setOpenChapters] = useState<Set<number>>(() => new Set());
  const toggleChapter = (ch: number) =>
    setOpenChapters((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });

  const chapterNums = [...foundByChapter.keys()]
    .filter((c) => c > 0)
    .sort((a, b) => b - a);
  const prior = chapterNums.filter((c) => c !== currentChapter);
  const thisFinds = foundByChapter.get(currentChapter) ?? [];
  const chapterSpan = (ch: number): number | null => {
    const lo = chapterThreshold(ch - 1);
    const hi = chapterThreshold(ch);
    if (!Number.isFinite(hi)) return null;
    return hi - lo;
  };
  const thisSpan = chapterSpan(currentChapter);

  return (
    <ResponsiveSheet open onDismiss={onDismiss} ariaLabel="Journey" className="cbagesheet">
      <span className="k">Journey</span>
      <h3>Chapter {currentChapter} — {foundCount} discoveries</h3>
      <p>
        {finite ? (
          <>Keep discovering. {left} more unique find{left === 1 ? "" : "s"} and you reach Chapter {currentChapter + 1}.</>
        ) : (
          <>You&apos;re deep into the collection — keep making new things to push your score higher.</>
        )}
      </p>
      <ol className="cbagelist">
        <li key={`chapter-${currentChapter}`} className="cbagerow on">
          <div className="cbagerow-top">
            <b className="cbageno">This chapter</b>
            <span className="cbagemeta">
              {thisSpan == null
                ? `${thisFinds.length} found`
                : `${thisFinds.length} of ${thisSpan} found`}
            </span>
          </div>
          {thisFinds.length > 0 && (
            <div className="cbagefinds" aria-label="Found this chapter">
              {thisFinds.map((id) => {
                const it = bundle.items.get(id);
                if (!it) return null;
                return <DiscoveryTile key={id} item={it} onInfo={onInfo} />;
              })}
            </div>
          )}
        </li>
        {prior.map((ch) => {
          const finds = foundByChapter.get(ch) ?? [];
          const isOpen = openChapters.has(ch);
          const span = ch === 0 ? null : chapterSpan(ch);
          const metaText =
            span == null
              ? `${finds.length} found`
              : `${finds.length} of ${span} found`;
          return (
            <li key={`chapter-${ch}`} className="cbagerow past">
              <button
                type="button"
                className="cbagerow-top"
                onClick={() => toggleChapter(ch)}
                aria-expanded={isOpen}
                style={{
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                }}
              >
                <b className="cbageno">Chapter {ch === 0 ? "—" : ch}</b>
                <span className="cbagemeta">{metaText} {isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen && finds.length > 0 && (
                <div className="cbagefinds" aria-label={`Found in Chapter ${ch}`}>
                  {finds.map((id) => {
                    const it = bundle.items.get(id);
                    if (!it) return null;
                    return <DiscoveryTile key={id} item={it} onInfo={onInfo} />;
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <button type="button" className="cbh cbback" onClick={onDismiss}>
        Done
      </button>
    </ResponsiveSheet>
  );
}

/** In-run manifest list for the Daily Journey sheet. One row per manifest
 *  item, with a trailing "Nt ago" chip for found items. Attribution is
 *  tracked client-side via a ref — the engine state does not record a
 *  per-manifest `foundAt`, and the data is cosmetic only. The ref resets
 *  when the manifest identity changes (daily rollover or new run). */
function ManifestRowList({
  manifest,
  manifestFound,
  moves,
  bundle,
  onInfo,
}: {
  manifest: string[];
  manifestFound: string[];
  moves: number;
  bundle: ThemeBundle;
  onInfo: (id: string) => void;
}) {
  const foundSet = useMemo(() => new Set(manifestFound), [manifestFound]);
  const manifestKey = manifest.join(",");

  // id → moves value at the turn the item was first marked found.
  const foundAtRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    foundAtRef.current = new Map();
  }, [manifestKey]);

  useEffect(() => {
    const map = foundAtRef.current;
    for (const id of manifestFound) {
      if (!map.has(id)) map.set(id, moves);
    }
  }, [manifestFound, moves]);

  return (
    <ol className="cbmanifest-rows" aria-label="Today's find list">
      {manifest.map((id) => {
        const it = bundle.items.get(id);
        const found = foundSet.has(id);
        const foundAt = foundAtRef.current.get(id);
        const delta = found && foundAt != null ? Math.max(0, moves - foundAt) : null;
        const label = it ? cap(it.name) : id;
        const meta = found
          ? delta === 0 || delta == null
            ? "just now"
            : `${delta}t ago`
          : "to find";
        const title = `${label} · ${found ? "found" : "to find"}`;
        return (
          <li key={id} className={`cbmanifest-row${found ? " found" : ""}`}>
            <button
              type="button"
              className="cbmanifest-row-btn"
              onClick={() => onInfo(id)}
              aria-label={title}
              title={title}
              disabled={!it}
            >
              <span
                className="cbmanifest-row-ic"
                style={it ? fillVar(it) : undefined}
                aria-hidden="true"
              >
                {it ? (
                  <Pictogram
                    name={it.name}
                    tier={it.tier}
                    kind={it.kind}
                    symbol={it.symbol}
                  />
                ) : null}
                {found && <span className="cbmanifest-row-check">✓</span>}
              </span>
              <span className="cbmanifest-row-name">{label}</span>
              <span className="cbmanifest-row-meta">{meta}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function DiscoveryTile({
  item,
  onInfo,
}: {
  item: CombineItem;
  onInfo: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="cbslot"
      style={fillVar(item)}
      title={cap(item.name)}
      aria-label={`${cap(item.name)}. Show how it's made`}
      onClick={() => onInfo(item.id)}
    >
      <Pictogram
        name={item.name}
        tier={item.tier}
        kind={item.kind}
        symbol={item.symbol}
      />
    </button>
  );
}
