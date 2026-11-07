import React, { useMemo, useState } from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import { ageNeed } from "@/combine/engine";
import type { GameState } from "@/combine/engine";
import { getGpOverrides } from "@/combine/gp-overrides";
import { chapterIndex, chapterThreshold } from "@/combine/progression";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { AGE_CHAINS } from "@/components/combine/board-parts/types";
import { fillVar } from "@/components/combine/board-parts/util";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";

export function AgesSheet({
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
  const ages = bundle.theme.ages;
  const softMode = getGpOverrides().mode === "soft";
  const current = state.age;
  const last = current >= ages.length - 1;
  // Banded: "unique on-band makes" counter. Soft: chapter progress against
  // cumulative discoveries. The two use the same visual slot (header + "N
  // more to unlock…") but back different counters.
  const foundCount = state.found.length;
  const softChapter = softMode ? chapterIndex(foundCount) : 0;
  const softNextThreshold = softMode ? chapterThreshold(softChapter + 1) : Number.POSITIVE_INFINITY;
  const softCurrentThreshold = softMode ? chapterThreshold(softChapter) : 0;
  const need = softMode ? softNextThreshold : ageNeed(current, bundle);
  const left = softMode
    ? Math.max(0, softNextThreshold - foundCount)
    : Math.max(0, need - state.ageMade);
  // Group this run's discoveries by the age the player actually made them
  // in (recipe.band at make time), falling back to the item's canonical
  // min-band for older saves that predate `madeAtBand`.
  const foundByBand = useMemo(() => {
    const bandOf = new Map<string, number>();
    for (const r of bundle.recipes) {
      const cur = bandOf.get(r.out);
      if (cur == null || r.band < cur) bandOf.set(r.out, r.band);
    }
    const m = new Map<number, string[]>();
    for (const id of state.found) {
      const b = state.madeAtBand[id] ?? bandOf.get(id);
      if (b == null) continue;
      let list = m.get(b);
      if (!list) {
        list = [];
        m.set(b, list);
      }
      list.push(id);
    }
    return m;
  }, [bundle, state.found, state.madeAtBand]);
  // Soft-mode grouping: discoveries by the chapter the player was in when
  // they found them. Chapter 1-indexed; chapter 0 is a graceful fallback
  // for pre-T-0170 saves where the attribution wasn't recorded (treat as
  // "unattributed").
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
  // Collapsible state for prior-chapter rows. Current chapter is always open.
  const [openChapters, setOpenChapters] = useState<Set<number>>(() => new Set());
  const toggleChapter = (ch: number) => {
    setOpenChapters((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  };
  // One canonical chain per theme + age index. Hand-picked by item name so
  // the diagram tells a clear "raw → refined → made" story. Items in the
  // bundle are keyed by UUID; we resolve name → id here. If a name goes
  // missing (KB rename, etc.) we drop that node and the row still renders.
  const nameToId = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, it] of bundle.items) m.set(it.name.toLowerCase(), id);
    return m;
  }, [bundle]);
  const chainNames = AGE_CHAINS[state.theme]?.[current] ?? [];
  const chain = chainNames
    .map((name) => nameToId.get(name.toLowerCase()))
    .filter((id): id is string => id != null);
  return (
    <ResponsiveSheet
      open
      onDismiss={onDismiss}
      ariaLabel="Ages"
      className="cbagesheet"
    >
      <span className="k">{softMode ? "Journey" : "Ages"}</span>
        <h3>
          {softMode
            ? `Chapter ${softChapter + 1} — ${foundCount} discoveries`
            : `Age ${ages[current]} — step ${current + 1} of ${ages.length}`}
        </h3>
        <p>
          {softMode ? (
            isFinite(softNextThreshold) ? (
              <>Keep discovering. {left} more unique find{left === 1 ? "" : "s"} and you reach Chapter {softChapter + 2}.</>
            ) : (
              <>You&apos;re deep into the collection — keep making new things to push your score higher.</>
            )
          ) : (
            <>
              Make combos at Age {ages[current]} to advance. Each successful
              Age-{ages[current]} combo counts — chains and makes at earlier
              ages don&apos;t.
              {last
                ? " You're on the final step — keep combining to push your score higher."
                : ` ${left} more Age-${ages[current]} combo${left === 1 ? "" : "s"} and you unlock ${ages[current + 1]}.`}
            </>
          )}
        </p>
        {!softMode && chain.length >= 2 && (
          <div className="cbageex">
            <b>Age {ages[current]} looks like this</b>
            <div className="cbagechain" aria-label={`Example chain from raw to Age ${ages[current]}`}>
              {chain.map((id, i) => {
                const it = bundle.items.get(id);
                if (!it) return null;
                return (
                  <span key={id} className="cbagechainnode">
                    <span
                      className="cbslot"
                      style={fillVar(it)}
                      title={cap(it.name)}
                      aria-label={cap(it.name)}
                    >
                      <Pictogram
                        name={it.name}
                        tier={it.tier}
                        kind={it.kind}
                        symbol={it.symbol}
                      />
                    </span>
                    <em>{cap(it.name)}</em>
                    {i < chain.length - 1 && (
                      <span className="cbagechainarrow" aria-hidden="true">
                        →
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {softMode ? (
          <ol className="cbagelist">
            {(() => {
              // Soft: group by chapter, newest-first, with "This chapter"
              // always expanded and prior chapters collapsible.
              const currentChapter = softChapter + 1;
              const chapterNums = [...foundByChapter.keys()].filter((c) => c > 0).sort((a, b) => b - a);
              // Always render "This chapter" row even if empty — shows the
              // header + helpful placeholder.
              const prior = chapterNums.filter((c) => c !== currentChapter);
              const rows: React.ReactNode[] = [];
              const thisFinds = foundByChapter.get(currentChapter) ?? [];
              // "X of Y found": Y is this chapter's discovery-span (threshold
              // delta). For the current chapter the span is the finite one
              // between current and next thresholds; open-ended tail renders
              // as just "X found".
              const chapterSpan = (ch: number): number | null => {
                const lo = chapterThreshold(ch);
                const hi = chapterThreshold(ch + 1);
                if (!Number.isFinite(hi)) return null;
                return hi - lo;
              };
              const thisSpan = chapterSpan(currentChapter);
              rows.push(
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
                        return (
                          <button
                            key={id}
                            type="button"
                            className="cbslot"
                            style={fillVar(it)}
                            title={cap(it.name)}
                            aria-label={`${cap(it.name)}. Show how it's made`}
                            onClick={() => onInfo(id)}
                          >
                            <Pictogram
                              name={it.name}
                              tier={it.tier}
                              kind={it.kind}
                              symbol={it.symbol}
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>,
              );
              for (const ch of prior) {
                const finds = foundByChapter.get(ch) ?? [];
                const isOpen = openChapters.has(ch);
                const span = ch === 0 ? null : chapterSpan(ch);
                const metaText =
                  span == null
                    ? `${finds.length} found`
                    : `${finds.length} of ${span} found`;
                rows.push(
                  <li key={`chapter-${ch}`} className="cbagerow past">
                    <button
                      type="button"
                      className="cbagerow-top"
                      onClick={() => toggleChapter(ch)}
                      aria-expanded={isOpen}
                      style={{ background: "transparent", border: 0, padding: 0, width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                    >
                      <b className="cbageno">Chapter {ch === 0 ? "—" : ch}</b>
                      <span className="cbagemeta">{metaText} {isOpen ? "▾" : "▸"}</span>
                    </button>
                    {isOpen && finds.length > 0 && (
                      <div className="cbagefinds" aria-label={`Found in Chapter ${ch}`}>
                        {finds.map((id) => {
                          const it = bundle.items.get(id);
                          if (!it) return null;
                          return (
                            <button
                              key={id}
                              type="button"
                              className="cbslot"
                              style={fillVar(it)}
                              title={cap(it.name)}
                              aria-label={`${cap(it.name)}. Show how it's made`}
                              onClick={() => onInfo(id)}
                            >
                              <Pictogram
                                name={it.name}
                                tier={it.tier}
                                kind={it.kind}
                                symbol={it.symbol}
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </li>,
                );
              }
              return rows;
            })()}
          </ol>
        ) : (
          <ol className="cbagelist">
            {ages.map((name, i) => {
              const isNow = i === current;
              const isPast = i < current;
              const metaNeed = ageNeed(i, bundle);
              const finds = foundByBand.get(i + 1) ?? [];
              const meta = isNow
                ? last
                  ? "Final"
                  : `${state.ageMade}/${metaNeed}`
                : isPast
                  ? `Done (${finds.length}/${metaNeed})`
                  : `Needs ${metaNeed}`;
              return (
                <li
                  key={name}
                  className={`cbagerow${isNow ? " on" : ""}${isPast ? " past" : ""}`}
                >
                  <div className="cbagerow-top">
                    <b className="cbageno">{name}</b>
                    <span className="cbagemeta">{meta}</span>
                  </div>
                  {finds.length > 0 && (
                    <div className="cbagefinds" aria-label={`Found in Age ${name}`}>
                      {finds.map((id) => {
                        const it = bundle.items.get(id);
                        if (!it) return null;
                        return (
                          <button
                            key={id}
                            type="button"
                            className="cbslot"
                            style={fillVar(it)}
                            title={cap(it.name)}
                            aria-label={`${cap(it.name)}. Show how it's made`}
                            onClick={() => onInfo(id)}
                          >
                            <Pictogram
                              name={it.name}
                              tier={it.tier}
                              kind={it.kind}
                              symbol={it.symbol}
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      <button
        type="button"
        className="cbh cbback"
        onClick={onDismiss}
      >
        Done
      </button>
    </ResponsiveSheet>
  );
}
