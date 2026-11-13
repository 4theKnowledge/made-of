import React, { useEffect, useMemo, useRef, useState } from "react";
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

/** T-0217 slice 2: newest completion row for the active theme, or null if
 *  never completed. Shape mirrors the row from
 *  GET /api/me/combine/theme-completion. */
export interface ThemeCompletion {
  themeCode: string;
  completedVersion: number;
  completedAt: string;
  itemCount: number;
}

export function CollectionBook({
  bundle,
  state,
  collection,
  signatures,
  newUnlocks,
  authed,
  authPending,
  themeCompletion = null,
  onInfo,
  onAcknowledge,
  onCompletionRecorded,
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
  /** T-0217 slice 2: newest completion row for this theme (null if never).
   *  Drives the "Complete" header badge, the "X new" stale banner, and the
   *  "Caught up" re-completion toast. */
  themeCompletion?: ThemeCompletion | null;
  onInfo: (id: string) => void;
  /** Called with an item id when the player taps a tile with a ★ badge,
   *  so the parent can clear the new-unlock marker. Also fires on list-row
   *  taps for consistency. Safe to omit if newUnlocks is empty. */
  onAcknowledge?: (id: string) => void;
  /** T-0217 slice 2: parent updates its cached completions when a
   *  re-completion POST succeeds. Fires once per mount at most. */
  onCompletionRecorded?: (row: ThemeCompletion) => void;
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
  const foundThisRun = useMemo(() => new Set(state.found), [state.found]);
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

  // T-0217 slice 2: three completion-aware states. Fast mode is excluded
  // (its finds never persist); daily is excluded (daily uses its own
  // target/win surface). Signed-out players can't persist completions at
  // all so they always see the baseline N-of-M.
  const currentVersion = bundle.theme.collectionVersion;
  const completionEligible = authed && state.mode === "endless";
  const isComplete = completionEligible && got >= total && total > 0;
  const atCurrentVersion =
    themeCompletion?.completedVersion === currentVersion;
  const headerComplete = isComplete && atCurrentVersion;
  const staleGrowable =
    completionEligible &&
    !!themeCompletion &&
    themeCompletion.completedVersion < currentVersion &&
    got < total;
  const newSinceComplete = staleGrowable
    ? Math.max(0, total - themeCompletion!.itemCount)
    : 0;
  const caughtUp =
    completionEligible &&
    !!themeCompletion &&
    themeCompletion.completedVersion < currentVersion &&
    got >= total;

  // Fire-once POST + toast for the re-completion path. Also runs on true
  // first-time completion if the GameOverCard never got a chance to POST
  // (e.g. player opened the book mid-run that completed the theme).
  const [caughtUpBannerVisible, setCaughtUpBannerVisible] = useState(false);
  const posted = useRef(false);
  useEffect(() => {
    if (!completionEligible || !isComplete || atCurrentVersion) return;
    if (posted.current) return;
    posted.current = true;
    const delta = themeCompletion
      ? Math.max(0, total - themeCompletion.itemCount)
      : total;
    if (caughtUp) setCaughtUpBannerVisible(true);
    void (async () => {
      try {
        const res = await fetch("/api/me/combine/theme-completion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            themeCode: bundle.theme.k,
            version: currentVersion,
          }),
        });
        if (!res.ok) return;
        onCompletionRecorded?.({
          themeCode: bundle.theme.k,
          completedVersion: currentVersion,
          itemCount: total,
          completedAt: new Date().toISOString(),
        });
      } catch {
        // best-effort; server reconciles on next GET
      }
    })();
    // delta referenced only by the toast message below — see JSX
    void delta;
  }, [
    completionEligible,
    isComplete,
    atCurrentVersion,
    caughtUp,
    bundle.theme.k,
    currentVersion,
    total,
    themeCompletion,
    onCompletionRecorded,
  ]);
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
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
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
    const ids = q
      ? [...findsForTheme.keys()].filter((id) => {
          const name = bundle.items.get(id)?.name;
          return !!name && name.toLowerCase().includes(q);
        })
      : [...findsForTheme.keys()];
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
  }, [findsForTheme, sort, bundle.items, bundle.outBand, cat.no, q]);

  // Grid view: precompute per-kind filtered items and total match counts so
  // we can hide empty kind sections and show a single "X of Y" tally.
  const filteredKinds = useMemo(() => {
    if (!q) {
      let total = 0;
      for (const { items } of catKinds.kinds) total += items.length;
      return { kinds: catKinds.kinds, matched: total, total };
    }
    let matched = 0;
    let total = 0;
    const kinds = catKinds.kinds
      .map(({ kind, items }) => {
        total += items.length;
        const filtered = items.filter((id) => {
          const name = bundle.items.get(id)?.name;
          return !!name && name.toLowerCase().includes(q);
        });
        matched += filtered.length;
        return { kind, items: filtered };
      })
      .filter((k) => k.items.length > 0);
    return { kinds, matched, total };
  }, [catKinds.kinds, bundle.items, q]);
  return (
    <ResponsiveSheet
      open
      onDismiss={onDismiss}
      ariaLabel="Collection"
      className="cbbook"
    >
      <span className="k">
        Collection · {state.daily ? "Daily" : bundle.theme.name}
        {headerComplete && (
          <span className="cbbook-complete" aria-label="Complete">
            ✓ Complete
          </span>
        )}
      </span>
        <b className="big2">
          {headerComplete ? (
            <>
              {total} <small>of {total}</small>
            </>
          ) : (
            <>
              {got} <small>of {total}</small>
            </>
          )}
          {staleGrowable && newSinceComplete > 0 && (
            <span className="cbbook-new" aria-label={`${newSinceComplete} new`}>
              {newSinceComplete} new
            </span>
          )}
        </b>
        <div className={`cbbar${headerComplete ? " done" : ""}`}>
          <i style={{ width: `${pct}%` }} />
        </div>
        {caughtUpBannerVisible && (
          <div
            className="cbbook-caughtup"
            role="status"
            aria-live="polite"
          >
            <span>
              Caught up · {Math.max(0, total - (themeCompletion?.itemCount ?? total))} new item
              {Math.max(0, total - (themeCompletion?.itemCount ?? total)) === 1 ? "" : "s"} collected
            </span>
            <button
              type="button"
              className="cbbook-caughtup-x"
              aria-label="Dismiss"
              onClick={() => setCaughtUpBannerVisible(false)}
            >
              ×
            </button>
          </div>
        )}
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
        {(got > 0 || view === "grid") && (
          <div className="cbbooksearch" role="search">
            <span className="cbbooksearch-icon" aria-hidden="true">⌕</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                view === "grid" ? "Search items…" : "Search discoveries…"
              }
              aria-label="Search collection"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            {query && (
              <>
                <span className="cbbooksearch-count" aria-live="polite">
                  {view === "grid"
                    ? `${filteredKinds.matched}/${filteredKinds.total}`
                    : `${sortedFinds.length}/${got}`}
                </span>
                <button
                  type="button"
                  className="cbbooksearch-clear"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                >
                  ×
                </button>
              </>
            )}
          </div>
        )}
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
            ) : sortedFinds.length === 0 ? (
              <p className="sub cbbooksearch-empty">
                No discoveries match “{query.trim()}”.
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
                const foundThisRound = foundThisRun.has(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`cbbookrow${isNew ? " unlock" : ""}${
                      isMastered ? " mastered" : ""
                    }${madeThisRun ? " made" : ""}${
                      foundThisRound ? " this-round" : ""
                    }`}
                    aria-label={`${cap(it.name)}${
                      isNew ? ", new in your collection" : ""
                    }${foundThisRound ? ", found this round" : ""}${
                      isMastered ? ", mastered" : ""
                    }${
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
                          {foundThisRound && (
                            <span
                              className="cbbookrow-this-round"
                              aria-hidden="true"
                            >
                              new
                            </span>
                          )}
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
          {filteredKinds.kinds.length === 0 && (
            <p className="sub cbbooksearch-empty">
              No items match “{query.trim()}”.
            </p>
          )}
          {filteredKinds.kinds.map(({ kind, items }) => {
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
                    const foundThisRound = foundThisRun.has(id);
                    const tileClasses: string[] = [];
                    if (isNew) tileClasses.push("unlock");
                    if (isMastered) tileClasses.push("mastered");
                    if (madeThisRun) tileClasses.push("made");
                    if (foundThisRound) tileClasses.push("this-round");
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
                        }${foundThisRound ? ", found this round" : ""}${
                          isMastered ? ", mastered" : ""
                        }${
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
                        {foundThisRound && !isNew && (
                          <span className="cbthisround-dot" aria-hidden="true" />
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
