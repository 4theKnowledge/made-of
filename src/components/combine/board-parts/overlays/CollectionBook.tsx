import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Pictogram } from "@/pictograms/Pictogram";
import { catalogue, catalogueByKind } from "@/combine/data";
import type { GameState } from "@/combine/engine";
import type { CombineRecipe, ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { CombineTile } from "@/components/combine/board-parts/CombineTile";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";
import { computeMastery } from "@/components/combine/board-parts/types";

const EMPTY_SET: ReadonlySet<string> = new Set();

export function CollectionBook({
  bundle,
  state,
  collection,
  signatures,
  newUnlocks,
  authed,
  authPending,
  onInfo,
  onAcknowledge,
  onDismiss,
}: {
  bundle: ThemeBundle;
  state: GameState;
  /** Lifetime finds: itemId → firstFoundAt epoch ms. Signed-in users carry
   *  this across games; signed-out users accumulate it only in memory. */
  collection: Map<string, number>;
  /** Per-item recipe signatures the player has produced. Omit or pass an
   *  empty map for signed-out / pre-mastery clients — tiles just won't
   *  show mastery badges. */
  signatures?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Unacknowledged lifetime-unlock ids. Tiles render a ★ until the player
   *  taps them (which fires `onAcknowledge`). Omit = no badges. */
  newUnlocks?: ReadonlySet<string>;
  authed: boolean;
  authPending: boolean;
  onInfo: (id: string) => void;
  /** Called with an item id when the player taps a tile with a ★ badge,
   *  so the parent can clear the new-unlock marker. Also fires on list-row
   *  taps for consistency. Safe to omit if newUnlocks is empty. */
  onAcknowledge?: (id: string) => void;
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
  // record() call, but merging keeps the UI robust). Fast mode is
  // score-only — its finds never persist — so skip the merge there and
  // show only the true lifetime collection (read-only during a fast run).
  const findsForTheme = useMemo(() => {
    const now = Date.now();
    const merged = new Map<string, number>();
    for (const [id, t] of collection) {
      if (collectables.has(id)) merged.set(id, t);
    }
    if (state.mode !== "fast") {
      for (const id of state.found) {
        if (!merged.has(id) && collectables.has(id)) merged.set(id, now);
      }
    }
    return merged;
  }, [collection, state.found, state.mode, collectables]);
  const got = findsForTheme.size;
  const pct = Math.round((100 * got) / Math.max(1, total));
  // "Known" for mastery = everything in findsForTheme (lifetime + this-run
  // merged) plus raw base ingredients. The computeMastery helper also
  // consults bundle.base, but passing a fully-formed known set keeps the
  // denominator honest when the player has unlocked a base-ingredient-only
  // item via a leak.
  const knownForMastery = useMemo(() => {
    const s = new Set<string>(findsForTheme.keys());
    for (const id of bundle.base) s.add(id);
    return s;
  }, [findsForTheme, bundle.base]);
  // Per-item mastery for everything the player has unlocked. Derived on
  // demand; bounded by `findsForTheme.size`.
  const masteryByItem = useMemo(() => {
    const m = new Map<
      string,
      { made: number; available: number; mastered: boolean }
    >();
    if (!signatures) return m;
    for (const id of findsForTheme.keys()) {
      const sigs = signatures.get(id);
      m.set(
        id,
        computeMastery(bundle, id, knownForMastery, sigs ?? EMPTY_SET),
      );
    }
    return m;
  }, [findsForTheme, signatures, bundle, knownForMastery]);
  const masteredCount = useMemo(() => {
    let n = 0;
    for (const info of masteryByItem.values()) if (info.mastered) n++;
    return n;
  }, [masteryByItem]);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<"recent" | "alpha" | "kind" | "chapter">("recent");
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
      case "chapter":
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
        {masteredCount > 0 && (
          <div className="cbbook-mastery" aria-label={`Mastered: ${masteredCount}`}>
            <span aria-hidden="true">◆</span> {masteredCount} mastered
          </div>
        )}
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
              <option value="chapter">Chapter</option>
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
                const m = masteryByItem.get(id);
                const isNew = newUnlocks?.has(id) ?? false;
                const isMastered = m?.mastered ?? false;
                const showProgress =
                  !!m && m.available > 1 && m.made < m.available;
                const madeCount = state.madeCounts[id] ?? 0;
                const madeThisRun = madeCount > 0;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`cbbookrow${isNew ? " unlock" : ""}${
                      isMastered ? " mastered" : ""
                    }${madeThisRun ? " made" : ""}`}
                    aria-label={`${cap(it.name)}${
                      isNew ? ", new in your collection" : ""
                    }${isMastered ? ", mastered" : ""}${
                      showProgress
                        ? `, ${m!.made} of ${m!.available} recipes`
                        : ""
                    }${
                      madeThisRun
                        ? `, made ${madeCount} time${madeCount === 1 ? "" : "s"} this run`
                        : ""
                    }`}
                    onClick={() => {
                      if (isNew) onAcknowledge?.(id);
                      onInfo(id);
                    }}
                  >
                    <span className="cbbookrow-head">
                      <CombineTile
                        as="span"
                        variant="slot"
                        item={it}
                        className={isNew ? "unlock" : undefined}
                        aria-hidden="true"
                      >
                        {isNew && (
                          <span className="cbunlock-star" aria-hidden="true">
                            ★
                          </span>
                        )}
                      </CombineTile>
                      <span className="cbbookrow-text">
                        <b>
                          {cap(it.name)}
                          {isMastered && (
                            <span
                              className="cbbookrow-mastery"
                              aria-label="Mastered"
                            >
                              <span aria-hidden="true">◆</span>
                            </span>
                          )}
                          {showProgress && (
                            <span
                              className="cbbookrow-progress"
                              aria-label={`${m!.made} of ${m!.available} recipes`}
                            >
                              {m!.made}/{m!.available}
                            </span>
                          )}
                          {madeThisRun && (
                            <span
                              className="cbbookrow-made"
                              aria-hidden="true"
                            >
                              ×{madeCount} this run
                            </span>
                          )}
                        </b>
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
                          <span key={i} className="cbchip cbchip-xs cbchip-muted">
                            {r.all.map((ing, k) => {
                              const ingIt = bundle.items.get(ing);
                              const name = ingIt ? cap(ingIt.name) : ing;
                              return (
                                <React.Fragment key={k}>
                                  {k > 0 && <i>+</i>}
                                  <span>
                                    {ingIt && (
                                      <Pictogram
                                        name={ingIt.name}
                                        tier={ingIt.tier}
                                        kind={ingIt.kind}
                                        symbol={ingIt.symbol}
                                      />
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
                    const m = masteryByItem.get(id);
                    const isNew = newUnlocks?.has(id) ?? false;
                    const isMastered = m?.mastered ?? false;
                    const showProgress =
                      !!m && m.available > 1 && m.made < m.available;
                    const madeCount = state.madeCounts[id] ?? 0;
                    const madeThisRun = madeCount > 0;
                    const tileClasses: string[] = [];
                    if (isNew) tileClasses.push("unlock");
                    if (isMastered) tileClasses.push("mastered");
                    if (madeThisRun) tileClasses.push("made");
                    return (
                      <CombineTile
                        key={id}
                        variant="book"
                        item={it}
                        label
                        className={
                          tileClasses.length ? tileClasses.join(" ") : undefined
                        }
                        onClick={() => {
                          if (isNew) onAcknowledge?.(id);
                          onInfo(id);
                        }}
                        title={cap(it.name)}
                        aria-label={`${cap(it.name)}${
                          isNew ? ", new in your collection" : ""
                        }${isMastered ? ", mastered" : ""}${
                          showProgress
                            ? `, ${m!.made} of ${m!.available} recipes`
                            : ""
                        }${
                          madeThisRun
                            ? `, made ${madeCount} time${madeCount === 1 ? "" : "s"} this run`
                            : ""
                        }`}
                      >
                        <small>{relativeTime(foundAt)}</small>
                        {isNew && (
                          <span className="cbunlock-star" aria-hidden="true">
                            ★
                          </span>
                        )}
                        {isMastered && (
                          <span className="cbmastery-badge" aria-hidden="true">
                            ◆
                          </span>
                        )}
                        {showProgress && (
                          <span className="cbprogress-badge" aria-hidden="true">
                            {m!.made}/{m!.available}
                          </span>
                        )}
                        {madeThisRun && (
                          <span className="cbmade-badge" aria-hidden="true">
                            ×{madeCount}
                          </span>
                        )}
                      </CombineTile>
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
