import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Pictogram } from "@/pictograms/Pictogram";
import { catalogue, catalogueByKind } from "@/combine/data";
import type { GameState } from "@/combine/engine";
import type { CombineRecipe, ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";

export function CollectionBook({
  bundle,
  state,
  collection,
  authed,
  authPending,
  onInfo,
  onDismiss,
}: {
  bundle: ThemeBundle;
  state: GameState;
  /** Lifetime finds: itemId → firstFoundAt epoch ms. Signed-in users carry
   *  this across games; signed-out users accumulate it only in memory. */
  collection: Map<string, number>;
  authed: boolean;
  authPending: boolean;
  onInfo: (id: string) => void;
  onDismiss: () => void;
}) {
  const cat = useMemo(() => catalogue(bundle), [bundle]);
  const catKinds = useMemo(() => catalogueByKind(bundle), [bundle]);
  // Collectables = things the player can meet in play: outputs + base
  // ingredients. (Tools / "with" items that are never standalone tiles are
  // excluded via `bundle.base`, which already filters to real raw inputs.)
  const collectables = useMemo(() => {
    const s = new Set<string>(bundle.outputs);
    for (const id of bundle.base) s.add(id);
    return s;
  }, [bundle.outputs, bundle.base]);
  const total = collectables.size;
  // Merge the current game's new discoveries with the lifetime collection
  // so a signed-out player's in-game progress still shows in the book even
  // if the collection map hasn't caught up yet (both are driven by the same
  // record() call, but merging keeps the UI robust).
  const findsForTheme = useMemo(() => {
    const now = Date.now();
    const merged = new Map<string, number>();
    for (const [id, t] of collection) {
      if (collectables.has(id)) merged.set(id, t);
    }
    for (const id of state.found) {
      if (!merged.has(id) && collectables.has(id)) merged.set(id, now);
    }
    return merged;
  }, [collection, state.found, collectables]);
  const got = findsForTheme.size;
  const pct = Math.round((100 * got) / Math.max(1, total));
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<"recent" | "alpha" | "kind" | "age">("recent");
  // Recipes for every discovered output, grouped by id. The quick-lookup
  // list renders these inline so players don't have to tap through each
  // item to see how it's made.
  const recipesByOut = useMemo(() => {
    const m = new Map<string, CombineRecipe[]>();
    for (const r of bundle.recipes) {
      if (!findsForTheme.has(r.out)) continue;
      let list = m.get(r.out);
      if (!list) {
        list = [];
        m.set(r.out, list);
      }
      list.push(r);
    }
    return m;
  }, [bundle.recipes, findsForTheme]);
  const sortedFinds = useMemo(() => {
    const ids = [...findsForTheme.keys()];
    switch (sort) {
      case "alpha":
        return ids.sort((a, b) => {
          const na = bundle.items.get(a)?.name ?? a;
          const nb = bundle.items.get(b)?.name ?? b;
          return na.localeCompare(nb);
        });
      case "kind":
        return ids.sort((a, b) => {
          const ia = bundle.items.get(a);
          const ib = bundle.items.get(b);
          const ka = ia?.kind ?? "";
          const kb = ib?.kind ?? "";
          if (ka !== kb) return ka.localeCompare(kb);
          return (ia?.name ?? "").localeCompare(ib?.name ?? "");
        });
      case "age":
        return ids.sort((a, b) => {
          const ba = bundle.outBand.get(a) ?? 99;
          const bb = bundle.outBand.get(b) ?? 99;
          if (ba !== bb) return ba - bb;
          return (cat.no.get(a) ?? 0) - (cat.no.get(b) ?? 0);
        });
      case "recent":
      default:
        return ids.sort(
          (a, b) => (findsForTheme.get(b) ?? 0) - (findsForTheme.get(a) ?? 0),
        );
    }
  }, [findsForTheme, sort, bundle.items, bundle.outBand, cat.no]);
  return (
    <ResponsiveSheet
      open
      onDismiss={onDismiss}
      ariaLabel="Collection"
      className="cbbook"
    >
      <span className="k">
        Collection · {state.daily ? "Daily" : bundle.theme.name}
      </span>
        <b className="big2">
          {got} <small>of {total}</small>
        </b>
        <div className="cbbar">
          <i style={{ width: `${pct}%` }} />
        </div>
        {!authPending && !authed && (
          <SignInCTA count={got} />
        )}
        <div className="cbbooktabs" role="tablist" aria-label="View">
          <button
            type="button"
            role="tab"
            aria-selected={view === "grid"}
            className={`cbbooktab${view === "grid" ? " on" : ""}`}
            onClick={() => setView("grid")}
          >
            All ({total})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            className={`cbbooktab${view === "list" ? " on" : ""}`}
            onClick={() => setView("list")}
          >
            Discoveries ({got})
          </button>
        </div>
        {view === "list" && got > 0 && (
          <div className="cbbooksort">
            <label htmlFor="cbbooksortsel">Sort</label>
            <select
              id="cbbooksortsel"
              value={sort}
              onChange={(e) =>
                setSort(e.target.value as typeof sort)
              }
            >
              <option value="recent">Recent</option>
              <option value="alpha">A–Z</option>
              <option value="kind">Kind</option>
              <option value="age">Age</option>
            </select>
          </div>
        )}
        {view === "list" ? (
          <div className="cbbooklist">
            {got === 0 ? (
              <p className="sub">
                No discoveries yet. Find combos in a run to fill this list.
              </p>
            ) : (
              sortedFinds.map((id) => {
                const it = bundle.items.get(id);
                if (!it) return null;
                const recipes = recipesByOut.get(id) ?? [];
                const no = String(cat.no.get(id)).padStart(3, "0");
                const foundAt = findsForTheme.get(id) ?? 0;
                return (
                  <button
                    key={id}
                    type="button"
                    className="cbbookrow"
                    onClick={() => {
                      onInfo(id);
                    }}
                  >
                    <span className="cbbookrow-head">
                      <span
                        className="cbslot"
                        style={fillVar(it)}
                        aria-hidden="true"
                      >
                        <Pictogram
                          name={it.name}
                          tier={it.tier}
                          kind={it.kind}
                          symbol={it.symbol}
                        />
                      </span>
                      <span className="cbbookrow-text">
                        <b>{cap(it.name)}</b>
                        <small>
                          No. {no} · {it.kind} · {relativeTime(foundAt)}
                        </small>
                      </span>
                    </span>
                    <span className="cbbookrow-recipes">
                      {recipes.length === 0 ? (
                        <em className="cbbookrow-none">base ingredient</em>
                      ) : (
                        recipes.map((r, i) => (
                          <span key={i} className="cbrcp">
                            {r.all.map((ing, k) => {
                              const ingIt = bundle.items.get(ing);
                              const name = ingIt ? cap(ingIt.name) : ing;
                              return (
                                <React.Fragment key={k}>
                                  {k > 0 && <i>+</i>}
                                  <span>
                                    {ingIt && (
                                      <span
                                        className="ic"
                                        aria-hidden="true"
                                      >
                                        <Pictogram
                                          name={ingIt.name}
                                          tier={ingIt.tier}
                                          kind={ingIt.kind}
                                          symbol={ingIt.symbol}
                                        />
                                      </span>
                                    )}
                                    {name}
                                  </span>
                                </React.Fragment>
                              );
                            })}
                          </span>
                        ))
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        ) : (
        <div className="cbbookages">
          {catKinds.kinds.map(({ kind, items }) => {
            const kindGot = items.filter((x) => findsForTheme.has(x)).length;
            return (
              <div key={kind} className="cbbage">
                <div className="bh">
                  <b>{cap(kind)}</b>
                  <span>
                    {kindGot}/{items.length}
                  </span>
                </div>
                <div className="bg">
                  {items.map((id) => {
                    const it = bundle.items.get(id);
                    if (!it) return null;
                    const foundAt = findsForTheme.get(id);
                    if (foundAt === undefined) {
                      return (
                        <span
                          key={id}
                          className="bk unk"
                          aria-label={`${cap(it.name)}, not found yet`}
                        >
                          <Pictogram
                            name={it.name}
                            tier={it.tier}
                            kind={it.kind}
                            symbol={it.symbol}
                          />
                          <span>?</span>
                          <small>&nbsp;</small>
                        </span>
                      );
                    }
                    return (
                      <button
                        key={id}
                        type="button"
                        className="bk"
                        style={fillVar(it)}
                        onClick={() => {
                          onInfo(id);
                        }}
                        title={cap(it.name)}
                      >
                        <Pictogram
                          name={it.name}
                          tier={it.tier}
                          kind={it.kind}
                          symbol={it.symbol}
                        />
                        <span>{cap(it.name)}</span>
                        <small>{relativeTime(foundAt)}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        )}
      <button type="button" className="cbh cbback" onClick={onDismiss}>
        Back to the game
      </button>
    </ResponsiveSheet>
  );
}

/** Compact relative-time label for collection tiles. `foundAt` is epoch ms.
 *  A `0` sentinel (older migrated entries without a timestamp) renders as a
 *  dash so the tile doesn't lie about recency. */
function relativeTime(foundAt: number): string {
  if (!foundAt) return "—";
  const diff = Date.now() - foundAt;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

/** Collection CTA for signed-out players. The collection they're building
 *  right now won't carry over to the next game until they sign in. */
function SignInCTA({ count }: { count: number }) {
  return (
    <div
      className="cbcta"
      role="note"
      aria-label="Sign in to save your collection"
    >
      <b>
        {count > 0
          ? `${count} discover${count === 1 ? "y" : "ies"} this session`
          : "Sign in to keep your collection"}
      </b>
      <span>
        Discoveries reset when you start a new game. Sign in to keep them
        across every game, forever.
      </span>
      <Link className="cbh" href="/sign-in">
        Sign in
      </Link>
    </div>
  );
}
