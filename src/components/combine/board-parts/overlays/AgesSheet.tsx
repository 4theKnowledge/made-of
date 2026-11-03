import React, { useMemo } from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import { ageNeed } from "@/combine/engine";
import type { GameState } from "@/combine/engine";
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
  const current = state.age;
  const last = current >= ages.length - 1;
  const need = ageNeed(current, bundle);
  const left = Math.max(0, need - state.ageMade);
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
      <span className="k">Ages</span>
        <h3>
          Age {ages[current]} — step {current + 1} of {ages.length}
        </h3>
        <p>
          Make combos at Age {ages[current]} to advance. Each successful
          Age-{ages[current]} combo counts — chains and makes at earlier
          ages don&apos;t.
          {last
            ? " You're on the final step — keep combining to push your score higher."
            : ` ${left} more Age-${ages[current]} combo${left === 1 ? "" : "s"} and you unlock ${ages[current + 1]}.`}
        </p>
        {chain.length >= 2 && (
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
        <ol className="cbagelist">
          {ages.map((name, i) => {
            const isNow = i === current;
            const isPast = i < current;
            const metaNeed = ageNeed(i, bundle);
            const meta = isNow
              ? last
                ? "Final"
                : `${state.ageMade}/${metaNeed}`
              : isPast
                ? "Done"
                : `Needs ${metaNeed}`;
            const finds = foundByBand.get(i + 1) ?? [];
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
      <button
        type="button"
        className="cbh"
        onClick={onDismiss}
        style={{ width: "100%", justifyContent: "center" }}
      >
        Done
      </button>
    </ResponsiveSheet>
  );
}
