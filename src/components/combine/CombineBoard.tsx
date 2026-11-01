"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import { catalogue } from "@/combine/data";
import { newGame, reduce } from "@/combine/engine";
import type { Action, Event, GameState } from "@/combine/engine";
import { matchAt, matchOn } from "@/combine/match";
import { hydrateBundle, type SerialisedBundle } from "@/combine/serialise";
import type {
  CombineItem,
  CombineRecipe,
  ThemeBundle,
  ThemeKey,
} from "@/combine/types";
import { cap } from "@/lib/taxonomy";

/** Per-cell preview when a tray tile is selected. Mirrors cbPreview from
 *  the prototype. Each entry is either a found output to render as a ghost
 *  on an empty cell, or an "on" marker for a valid drop-on-top target. */
interface Preview {
  /** Output id if we have one to show (found alternatives only). */
  out?: string;
  /** True for drop-on-top targets. */
  on?: boolean;
  /** How many alternatives exist for this recipe (for the +N badge). */
  n?: number;
}

function computePreview(
  bundle: ThemeBundle,
  state: GameState,
  slot: number | null,
): Map<number, Preview> {
  const out = new Map<number, Preview>();
  if (slot == null) return out;
  const x = state.tray[slot];
  if (x == null) return out;
  const found = new Set(state.found);
  const altsOf = (r: CombineRecipe): CombineRecipe[] => {
    const key = [...r.all].sort().join("+");
    return bundle.sameIngredients.get(key) ?? [r];
  };
  const knownAlt = (r: CombineRecipe): CombineRecipe | null => {
    const alts = altsOf(r);
    return alts.find((q) => found.has(q.out)) ?? null;
  };
  for (let i = 0; i < state.board.length; i++) {
    const v = state.board[i];
    if (v) {
      const m = matchOn(bundle, state.board, i, x, state.n);
      if (!m) continue;
      const k = knownAlt(m.recipe);
      if (k) out.set(i, { out: k.out, on: true, n: altsOf(m.recipe).length });
    }
  }
  for (let i = 0; i < state.board.length; i++) {
    if (state.board[i]) continue;
    const m = matchAt(bundle, state.board, i, x, state.n);
    if (!m) continue;
    const k = knownAlt(m.recipe);
    if (k) out.set(i, { out: k.out, n: altsOf(m.recipe).length });
  }
  return out;
}

/**
 * Transient per-move visual state. Keys match the prototype's `renderCB(fx)`
 * contract. Each entry is set from an engine event, applied as a CSS class
 * or badge on the matching cell, and cleared after its animation duration.
 */
interface Fx {
  placed?: number;
  nope?: number;
  fuse?: Set<number>;
  pop?: number;
  burst?: { at: number; pts: number; mult: number };
  shipped?: { at: number; bonus: number };
  crumble?: Set<number>;
  /** Chain multiplier for the top-row ×N badge. */
  chain?: number;
  /** Close-call bonus for the "Close call!" badge. */
  close?: number;
}

interface Props {
  bundle: SerialisedBundle;
}

/** The top-level client component that owns engine state. */
export function CombineBoard({ bundle: serialised }: Props) {
  const bundle = useMemo(() => hydrateBundle(serialised), [serialised]);
  const initial = useMemo(() => {
    // Deterministic start on the client. Daily seeding lands in Phase 5.
    // 6×6 for everyone until the responsive 5×5 on phones + daily arrives
    // (hydration-safe: don't read window during the initial render).
    return newGame("everyday", bundle, { seed: 42, size: 6 }).state;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [state, setState] = useState<GameState>(initial);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [helpersOpen, setHelpersOpen] = useState(false);
  const [fx, setFx] = useState<Fx>({});
  const [discovery, setDiscovery] = useState<{
    out: string;
    recipe: string[];
  } | null>(null);
  const [ageToast, setAgeToast] = useState<{
    age: number;
    sample: string[];
  } | null>(null);
  // The tile pressed and currently being held / dragged. Mirrors the
  // prototype's cbDrag record. Ghost x/y are in viewport coords.
  const [drag, setDrag] = useState<{
    slot: number;
    x: number;
    y: number;
    tileWidth: number;
    overCell: number | null;
    overOk: boolean;
  } | null>(null);
  const [infoTile, setInfoTile] = useState<string | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  // Pending clears so overlapping actions don't orphan timers.
  const timers = useRef<number[]>([]);
  useEffect(() => () => {
    for (const t of timers.current) window.clearTimeout(t);
  }, []);

  const scheduleClear = useCallback((patch: Partial<Fx>, delay: number) => {
    const id = window.setTimeout(() => {
      setFx((cur) => {
        const next: Fx = { ...cur };
        for (const k of Object.keys(patch) as (keyof Fx)[]) {
          delete next[k];
        }
        return next;
      });
    }, delay);
    timers.current.push(id);
  }, []);

  const applyEvents = useCallback(
    (events: Event[]) => {
      // Fold events into one fx patch so React batches a single render.
      const patch: Fx = {};
      let latestDiscovery: { out: string; recipe: string[] } | null = null;
      let latestAgeUp: { age: number; sample: string[] } | null = null;
      for (const e of events) {
        if (e.type === "placed") patch.placed = e.at;
        else if (e.type === "nope") patch.nope = e.at;
        else if (e.type === "combine") {
          patch.fuse = new Set([...(patch.fuse ?? []), ...e.cells]);
          patch.pop = e.at;
          patch.burst = { at: e.at, pts: e.pts, mult: e.mult };
          if (e.mult > 1) patch.chain = e.mult;
          if (e.close) patch.close = e.close;
        } else if (e.type === "shipped") {
          patch.shipped = { at: e.at, bonus: e.bonus };
        } else if (e.type === "crumble") {
          patch.crumble = new Set(e.cells);
        } else if (e.type === "discovery") {
          latestDiscovery = { out: e.out, recipe: e.recipe };
        } else if (e.type === "age-up") {
          latestAgeUp = { age: e.age, sample: e.sample };
        }
      }
      if (latestDiscovery) {
        setDiscovery(latestDiscovery);
        const id = window.setTimeout(() => setDiscovery(null), 4600);
        timers.current.push(id);
      }
      if (latestAgeUp) {
        setAgeToast(latestAgeUp);
        const id = window.setTimeout(() => setAgeToast(null), 4200);
        timers.current.push(id);
      }
      if (Object.keys(patch).length === 0) return;
      setFx((cur) => ({ ...cur, ...patch }));
      // Durations roughly match the prototype's cbWait timings.
      if (patch.placed != null) scheduleClear({ placed: 0 }, 260);
      if (patch.nope != null) scheduleClear({ nope: 0 }, 380);
      if (patch.fuse || patch.pop || patch.burst || patch.chain || patch.close) {
        scheduleClear(
          { fuse: undefined, pop: 0, burst: undefined, chain: 0, close: 0 },
          900,
        );
      }
      if (patch.shipped) scheduleClear({ shipped: undefined }, 480);
      if (patch.crumble) scheduleClear({ crumble: undefined }, 500);
    },
    [scheduleClear],
  );

  // Apply an action: run reduce once, update state, and route events.
  const act = useCallback(
    (action: Action) => {
      const r = reduce(state, bundle, action);
      setState(r.state);
      applyEvents(r.events);
      setSelectedSlot(null);
    },
    [state, bundle, applyEvents],
  );

  const onCellTap = useCallback(
    (cell: number) => {
      if (selectedSlot == null) return;
      const target = state.board[cell];
      if (target == null) {
        act({ type: "place", slot: selectedSlot, cell });
      } else {
        act({ type: "drop-on", slot: selectedSlot, cell });
      }
    },
    [act, selectedSlot, state.board],
  );

  // When a drag completed via drop or a long-press fired, we don't want
  // the trailing click to toggle selection. Set when either path consumes
  // the pointerup, cleared on the next pointerdown.
  const suppressClick = useRef(false);

  const onSlotTap = useCallback((slot: number) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setSelectedSlot((s) => (s === slot ? null : slot));
  }, []);

  // Close the helpers menu on any click outside it (except on the Helpers
  // button itself, which toggles it).
  useEffect(() => {
    if (!helpersOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".cbhelpmenu")) return;
      if (target.closest("#cbHelp")) return;
      setHelpersOpen(false);
    };
    window.addEventListener("click", onDocClick);
    return () => window.removeEventListener("click", onDocClick);
  }, [helpersOpen]);

  // Escape closes the top overlay in prototype order: info card, discovery
  // toast, age toast, helpers menu, selected tray tile. Doesn't dismiss the
  // choice picker (the engine is paused and needs a decision).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (infoTile) {
        setInfoTile(null);
        return;
      }
      if (discovery) {
        setDiscovery(null);
        return;
      }
      if (ageToast) {
        setAgeToast(null);
        return;
      }
      if (helpersOpen) {
        setHelpersOpen(false);
        return;
      }
      if (selectedSlot != null) {
        setSelectedSlot(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [infoTile, discovery, ageToast, helpersOpen, selectedSlot]);

  // Drag state is held in a ref for the hot path (pointermove), mirrored
  // to React state only when the over-cell changes so cells can light up.
  const dragRef = useRef<{
    slot: number;
    x0: number;
    y0: number;
    moved: boolean;
    tileWidth: number;
    holdTimer: number | null;
    overCell: number | null;
  } | null>(null);

  const endDrag = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.holdTimer != null) window.clearTimeout(d.holdTimer);
    const snapshot = drag;
    setDrag(null);
    if (!d.moved) return; // tap: handled on click
    suppressClick.current = true;
    if (snapshot?.overCell != null && snapshot.overOk) {
      const cell = snapshot.overCell;
      const target = state.board[cell];
      if (target == null) {
        act({ type: "place", slot: d.slot, cell });
      } else {
        act({ type: "drop-on", slot: d.slot, cell });
      }
    } else {
      setSelectedSlot(null);
    }
  }, [act, drag, state.board]);

  // Capture the tile under the pointer and whether a drop there would combine.
  const captureOver = useCallback(
    (x: number, y: number): { cell: number | null; ok: boolean } => {
      const el = document.elementFromPoint(x, y);
      const cellEl = el?.closest("[data-cb]") as HTMLElement | null;
      if (!cellEl) return { cell: null, ok: false };
      const cell = Number(cellEl.dataset.cb);
      const d = dragRef.current;
      if (d == null) return { cell: null, ok: false };
      const tile = state.tray[d.slot];
      if (tile == null) return { cell, ok: false };
      const target = state.board[cell];
      // Any empty cell is a valid drop target; occupied cells need a
      // recipe to form on drop-on-top. Mirrors cbOnOK in the prototype.
      const ok =
        target == null
          ? true
          : Boolean(matchOn(bundle, state.board, cell, tile, state.n));
      return { cell, ok };
    },
    [bundle, state.board, state.n, state.tray],
  );

  // Global pointermove / pointerup once a drag is in flight.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved) {
        if (
          Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 7
        )
          return;
        d.moved = true;
        if (d.holdTimer != null) {
          window.clearTimeout(d.holdTimer);
          d.holdTimer = null;
        }
        setSelectedSlot(d.slot);
      }
      const over = captureOver(e.clientX, e.clientY);
      d.overCell = over.cell;
      setDrag((cur) =>
        cur
          ? {
              ...cur,
              x: e.clientX,
              y: e.clientY,
              overCell: over.cell,
              overOk: over.ok,
            }
          : cur,
      );
    };
    const onUp = () => endDrag();
    const onCancel = () => {
      const d = dragRef.current;
      if (d?.holdTimer != null) window.clearTimeout(d.holdTimer);
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [drag, endDrag, captureOver]);

  const onSlotPointerDown = useCallback(
    (slot: number, e: React.PointerEvent<HTMLButtonElement>) => {
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const tile = state.tray[slot];
      if (tile == null) return;
      suppressClick.current = false;
      // Start a drag record.
      dragRef.current = {
        slot,
        x0: e.clientX,
        y0: e.clientY,
        moved: false,
        tileWidth: rect.width,
        holdTimer: null,
        overCell: null,
      };
      setDrag({
        slot,
        x: e.clientX,
        y: e.clientY,
        tileWidth: rect.width,
        overCell: null,
        overOk: false,
      });
      // 450ms long-press opens the detail card unless movement starts.
      const holdId = window.setTimeout(() => {
        const d = dragRef.current;
        if (!d || d.moved) return;
        setInfoTile(tile);
        setSelectedSlot(null);
        dragRef.current = null;
        setDrag(null);
        suppressClick.current = true;
      }, 450);
      dragRef.current.holdTimer = holdId;
    },
    [state.tray],
  );

  const onChoose = useCallback(
    (outputIndex: number) => {
      act({ type: "choose", outputIndex });
    },
    [act],
  );

  const onHelper = useCallback(
    (which: "hint" | "swap" | "clear" | "move") => {
      setHelpersOpen(false);
      // Clear and Move require a second tap on the board — those arrive in a
      // later patch. For now swap and hint just decrement counters via the
      // engine (hint content is Phase 4+).
      if (which === "hint" || which === "swap") {
        act({ type: which });
      }
    },
    [act],
  );

  const preview = useMemo(
    () => computePreview(bundle, state, selectedSlot),
    [bundle, state, selectedSlot],
  );

  return (
    <div className="cbwrap">
      <div id="cb">
        <TopBar
          state={state}
          fx={fx}
          helpersOpen={helpersOpen}
          onToggleHelpers={() => setHelpersOpen((o) => !o)}
          onHelper={onHelper}
          onTheme={() => setThemeOpen(true)}
        />
        <TipLine
          state={state}
          selectedSlot={selectedSlot}
          preview={preview}
        />
        <AgeBar
          state={state}
          bundle={bundle}
          onBook={() => setBookOpen(true)}
          onSound={() => setSoundOpen(true)}
        />
        <Shelf
          state={state}
          bundle={bundle}
          fx={fx}
          onInfo={(id) => setInfoTile(id)}
        />
        <Board
          state={state}
          bundle={bundle}
          fx={
            state.choosing
              ? {
                  ...fx,
                  fuse: new Set([
                    ...(fx.fuse ?? []),
                    ...state.choosing.cells,
                  ]),
                }
              : fx
          }
          preview={preview}
          dragOver={drag ? { cell: drag.overCell, ok: drag.overOk } : null}
          onCellTap={onCellTap}
        />
        <Tray
          state={state}
          bundle={bundle}
          selected={selectedSlot}
          onSlotTap={onSlotTap}
          onSlotPointerDown={onSlotPointerDown}
        />
        <p className="cbkey">
          <span>Everything that combines is used up</span>
          <span>
            <i className="k2" />
            Finished things go to your shelf
          </span>
        </p>
        {state.choosing && (
          <ChoicePicker
            state={state}
            bundle={bundle}
            onChoose={onChoose}
          />
        )}
        {state.over && (
          <GameOverCard
            state={state}
            bundle={bundle}
            onPlayAgain={() => {
              // Fresh deterministic game with a different seed each run.
              const next = newGame("everyday", bundle, {
                seed: (Math.random() * 4294967296) | 0,
                size: state.n,
              }).state;
              setState(next);
              setFx({});
              setDiscovery(null);
              setAgeToast(null);
              setInfoTile(null);
            }}
          />
        )}
        {ageToast && (
          <AgeToast
            toast={ageToast}
            bundle={bundle}
            onDismiss={() => setAgeToast(null)}
          />
        )}
        {discovery && (
          <DiscoveryToast
            discovery={discovery}
            bundle={bundle}
            onDismiss={() => setDiscovery(null)}
          />
        )}
        {infoTile && (
          <DetailCard
            tileId={infoTile}
            bundle={bundle}
            state={state}
            onDismiss={() => setInfoTile(null)}
          />
        )}
        {themeOpen && (
          <ThemeMenu
            bundle={bundle}
            daily={state.daily}
            onPick={(which) => {
              setThemeOpen(false);
              if (which === state.theme && !state.daily) return;
              // Switching restarts the game under the chosen theme.
              const nextBundle =
                which === state.theme
                  ? bundle
                  : // When Everything is picked we still only have Everyday
                    // bundle on the client. Phase 5 ships both bundles over
                    // the wire; for now ignore.
                    bundle;
              const next = newGame(which, nextBundle, {
                seed: (Math.random() * 4294967296) | 0,
                size: state.n,
              }).state;
              setState(next);
              setFx({});
              setDiscovery(null);
              setAgeToast(null);
              setInfoTile(null);
            }}
            onDismiss={() => setThemeOpen(false)}
          />
        )}
        {bookOpen && (
          <CollectionBook
            bundle={bundle}
            state={state}
            onInfo={(id) => setInfoTile(id)}
            onDismiss={() => setBookOpen(false)}
          />
        )}
        {soundOpen && (
          <SoundMenu onDismiss={() => setSoundOpen(false)} />
        )}
      </div>
      {drag && drag.slot != null && state.tray[drag.slot] != null && (
        <DragGhost
          tileId={state.tray[drag.slot]!}
          bundle={bundle}
          x={drag.x}
          y={drag.y}
          size={64}
        />
      )}
    </div>
  );
}

function DragGhost({
  tileId,
  bundle,
  x,
  y,
  size,
}: {
  tileId: string;
  bundle: ThemeBundle;
  x: number;
  y: number;
  size: number;
}) {
  const item = bundle.items.get(tileId);
  if (!item) return null;
  // Centre horizontally on finger, lift it so the finger doesn't cover it.
  const style: React.CSSProperties = {
    left: `${x - size / 2}px`,
    top: `${y - size * 0.9}px`,
    width: `${size}px`,
    height: `${size}px`,
    ...fillVar(item),
  };
  const words = tileId.split("-");
  const longest = Math.max(0, ...words.map((w) => w.length));
  const lenClass = longest >= 10 ? " l2" : longest >= 7 ? " l1" : "";
  return (
    <div className="cbghost" style={style} aria-hidden="true">
      <Pictogram
        name={item.name}
        tier={item.tier}
        kind={item.kind}
        symbol={item.symbol}
      />
      <span className={`cbn${lenClass}`}>{cap(item.name)}</span>
    </div>
  );
}

function DetailCard({
  tileId,
  bundle,
  state,
  onDismiss,
}: {
  tileId: string;
  bundle: ThemeBundle;
  state: GameState;
  onDismiss: () => void;
}) {
  const item = bundle.items.get(tileId);
  if (!item) return null;
  // Knowledge-base recipe: find the first recipe whose output is this tile.
  const madeFrom = bundle.recipes.find((r) => r.out === tileId);
  // Goes into: recipes that use this tile as an ingredient.
  const goesInto = (bundle.byIngredient.get(tileId) ?? []).filter(
    (r) => r.out !== tileId,
  );
  const foundGoesInto = goesInto.filter((r) => state.found.includes(r.out));
  const unfoundCount = goesInto.length - foundGoesInto.length;
  return (
    <>
      <div className="cbscrim" onClick={onDismiss} />
      <section
        className="cbover cbinfo"
        role="dialog"
        aria-label={cap(item.name)}
      >
        <div className="cbinfohd" style={fillVar(item)}>
          <Pictogram
            name={item.name}
            tier={item.tier}
            kind={item.kind}
            symbol={item.symbol}
          />
        </div>
        <div className="nm">{cap(item.name)}</div>
        {madeFrom ? (
          <div className="cbrcp" aria-label="Made from">
            {madeFrom.all.map((pid, k) => {
              const p = bundle.items.get(pid);
              if (!p) return null;
              return (
                <span key={pid}>
                  <Pictogram
                    name={p.name}
                    tier={p.tier}
                    kind={p.kind}
                    symbol={p.symbol}
                  />
                  {cap(p.name)}
                  {k < madeFrom.all.length - 1 && <i>+</i>}
                </span>
              );
            })}
            <i>=</i>
            <span>{cap(item.name)}</span>
          </div>
        ) : (
          <p className="fact">A raw thing.</p>
        )}
        {item.fact && <p className="fact">{item.fact}</p>}
        {goesInto.length > 0 && (
          <div
            className="cbrcp"
            aria-label="Goes into"
            style={{ marginTop: 4 }}
          >
            <b style={{ marginRight: 6 }}>Goes into:</b>
            {foundGoesInto.slice(0, 6).map((r) => {
              const o = bundle.items.get(r.out);
              if (!o) return null;
              return (
                <span key={r.out}>
                  <Pictogram
                    name={o.name}
                    tier={o.tier}
                    kind={o.kind}
                    symbol={o.symbol}
                  />
                  {cap(o.name)}
                </span>
              );
            })}
            {unfoundCount > 0 && (
              <span className="q">+{unfoundCount} to discover</span>
            )}
          </div>
        )}
        <div className="row2">
          <a className="cbh" href={`/explore/${item.id}`}>
            Full story in Explore
          </a>
          <button type="button" className="cbh" onClick={onDismiss}>
            Back to the game
          </button>
        </div>
      </section>
    </>
  );
}

function GameOverCard({
  state,
  bundle,
  onPlayAgain,
}: {
  state: GameState;
  bundle: ThemeBundle;
  onPlayAgain: () => void;
}) {
  const ages = bundle.theme.ages;
  const ageName = ages[state.age];
  // Best score is a Phase 5 persistence concern; for now compare against
  // this session only, which is always == score, so just show the current.
  const best = state.score;
  const newBest = state.newBest;
  // Mini-shelf: group by output.
  const shelfCounts = new Map<string, number>();
  for (const id of state.shelf) {
    shelfCounts.set(id, (shelfCounts.get(id) ?? 0) + 1);
  }
  const themeDiscovered = state.found.filter((x) =>
    bundle.outputs.has(x),
  ).length;
  const totalOutputs = bundle.outputs.size;
  return (
    <>
      <div className="cbscrim" />
      <section className="cbover" role="dialog" aria-label="Run over">
        <span className="k">{state.daily ? `Daily game · ${state.daily}` : "Board full"}</span>
        <b className="big">{state.score.toLocaleString("en")}</b>
        <span className="sub">
          {newBest
            ? "A new best!"
            : best > state.score
              ? `Your best is ${best.toLocaleString("en")}. ${(best - state.score).toLocaleString("en")} to go.`
              : `You reached the ${ageName.toLowerCase()} age.`}
        </span>
        <div className="cb3">
          <div>
            <b>{state.shelf.length}</b>
            <span>finished things</span>
          </div>
          <div>
            <b>{state.age + 1}</b>
            <span>{ageName.toLowerCase()} age</span>
          </div>
          <div>
            <b>{state.found.length}</b>
            <span>new discoveries</span>
          </div>
        </div>
        {state.shelf.length > 0 && (
          <div className="cbshelf sum">
            {[...shelfCounts.entries()].map(([id, n]) => {
              const it = bundle.items.get(id);
              if (!it) return null;
              return (
                <span
                  key={id}
                  className="cbslot"
                  style={fillVar(it)}
                  title={cap(it.name)}
                >
                  <Pictogram
                    name={it.name}
                    tier={it.tier}
                    kind={it.kind}
                    symbol={it.symbol}
                  />
                  {n > 1 && <b>{n}</b>}
                </span>
              );
            })}
          </div>
        )}
        {state.found.length > 0 && (
          <>
            <p className="sub" style={{ marginTop: 4 }}>
              New discoveries
            </p>
            <div className="cbfound">
              {state.found.slice(0, 10).map((id) => {
                const it = bundle.items.get(id);
                if (!it) return null;
                return (
                  <span key={id}>
                    <Pictogram
                      name={it.name}
                      tier={it.tier}
                      kind={it.kind}
                      symbol={it.symbol}
                    />
                    <em>{cap(it.name)}</em>
                  </span>
                );
              })}
              {state.found.length > 10 && (
                <span className="more">
                  +{state.found.length - 10} more in your collection
                </span>
              )}
            </div>
          </>
        )}
        <p className="sub">
          {themeDiscovered} of {totalOutputs} things discovered in{" "}
          {bundle.theme.name} so far.
        </p>
        <div className="row2">
          <button type="button" className="cbh" onClick={onPlayAgain}>
            Play again
          </button>
        </div>
      </section>
    </>
  );
}

/* ---------- Theme menu ---------- */

function ThemeMenu({
  bundle,
  daily,
  onPick,
  onDismiss,
}: {
  bundle: ThemeBundle;
  daily: string | null;
  onPick: (which: ThemeKey) => void;
  onDismiss: () => void;
}) {
  // Phase 3 ships only the Everyday bundle, so the Everything option is
  // present but disabled with a note. Phase 5 ships both.
  const current = bundle.theme.k;
  const everydayCount = bundle.outputs.size;
  return (
    <>
      <div className="cbscrim" onClick={onDismiss} />
      <section
        className="cbover cbthemes"
        role="dialog"
        aria-label="Choose a theme"
      >
        <span className="k">Today</span>
        <button
          type="button"
          className={`cbtopt cbdaily${daily ? " on" : ""}`}
          disabled
        >
          <b>Daily game</b>
          <span>
            Same start and same tiles for everyone today. One go. Everyday
            theme, 5×5.
          </span>
          <em>Coming soon</em>
        </button>
        <span className="k">Endless</span>
        <button
          type="button"
          className={`cbtopt${current === "everyday" && !daily ? " on" : ""}`}
          onClick={() => onPick("everyday")}
        >
          <b>Everyday</b>
          <span>
            Food, drink, clothes, toys and things around the house.
          </span>
          <em>{everydayCount} things to make</em>
        </button>
        <button
          type="button"
          className={`cbtopt${current === "everything" && !daily ? " on" : ""}`}
          disabled
        >
          <b>Everything</b>
          <span>
            The whole map: atoms, stars, life, food, factories, machines.
          </span>
          <em>Available with the daily release</em>
        </button>
        <p className="sub">
          Games are saved as you go. Switching picks up where you left off.
        </p>
        <button
          type="button"
          className="cbh"
          onClick={onDismiss}
          style={{
            width: "100%",
            justifyContent: "center",
          }}
        >
          Cancel
        </button>
      </section>
    </>
  );
}

/* ---------- Sound menu ---------- */

function SoundMenu({ onDismiss }: { onDismiss: () => void }) {
  // Phase 3 ships no actual audio engine; this menu holds the three
  // settings in local state so controls feel real. Phase 6 wires them up.
  const [music, setMusic] = useState<"piano" | "handpan" | "off">("off");
  const [sfx, setSfx] = useState(false);
  const [vol, setVol] = useState(80);
  const tracks: Array<["piano" | "handpan" | "off", string, string]> = [
    ["piano", "Calm piano", "Slow, soft and roomy"],
    ["handpan", "Handpan", "Gentle and a bit busier"],
    ["off", "No music", ""],
  ];
  return (
    <>
      <div className="cbscrim" onClick={onDismiss} />
      <section
        className="cbover cbsoundm"
        role="dialog"
        aria-label="Music and sound"
      >
        <span className="k">Music</span>
        {tracks.map(([k, n, d]) => (
          <button
            key={k}
            type="button"
            className={`cbtopt${music === k ? " on" : ""}`}
            onClick={() => setMusic(k)}
          >
            <b>{n}</b>
            {d && <span>{d}</span>}
          </button>
        ))}
        <span className="k">Sound</span>
        <button
          type="button"
          className={`cbtopt cbsw${sfx ? " on" : ""}`}
          role="switch"
          aria-checked={sfx}
          onClick={() => setSfx((s) => !s)}
        >
          <b>Sound effects</b>
          <span>{sfx ? "On" : "Off"}</span>
        </button>
        <label className="cbvol">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={vol}
            onChange={(e) => setVol(Number(e.currentTarget.value))}
            aria-label="Volume"
          />
        </label>
        <button
          type="button"
          className="cbh"
          onClick={onDismiss}
          style={{ width: "100%", justifyContent: "center" }}
        >
          Done
        </button>
      </section>
    </>
  );
}

/* ---------- Collection book ---------- */

function CollectionBook({
  bundle,
  state,
  onInfo,
  onDismiss,
}: {
  bundle: ThemeBundle;
  state: GameState;
  onInfo: (id: string) => void;
  onDismiss: () => void;
}) {
  const cat = useMemo(() => catalogue(bundle), [bundle]);
  const total = bundle.outputs.size;
  const got = state.found.filter((x) => bundle.outputs.has(x)).length;
  const pct = Math.round((100 * got) / Math.max(1, total));
  return (
    <>
      <div className="cbscrim" onClick={onDismiss} />
      <section
        className="cbover cbbook"
        role="dialog"
        aria-label="Collection"
      >
        <span className="k">Collection · {bundle.theme.name}</span>
        <b className="big2">
          {got} <small>of {total}</small>
        </b>
        <div className="cbbar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="cbbookages">
          {cat.byAge.map((list, k) => {
            const ageGot = list.filter((x) => state.found.includes(x))
              .length;
            return (
              <div key={k} className="cbbage">
                <div className="bh">
                  <b>{bundle.theme.ages[k]}</b>
                  <span>
                    {ageGot}/{list.length}
                  </span>
                </div>
                <div className="bg">
                  {list.map((id) => {
                    const it = bundle.items.get(id);
                    if (!it) return null;
                    const found = state.found.includes(id);
                    const no = String(cat.no.get(id)).padStart(3, "0");
                    if (!found) {
                      return (
                        <span
                          key={id}
                          className="bk unk"
                          aria-label={`No. ${no}, not found yet`}
                        >
                          <i className="no">{no}</i>
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
                          onDismiss();
                        }}
                        title={cap(it.name)}
                      >
                        <i className="no">{no}</i>
                        <Pictogram
                          name={it.name}
                          tier={it.tier}
                          kind={it.kind}
                          symbol={it.symbol}
                        />
                        <span>{cap(it.name)}</span>
                        <small>early find</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="cbh"
          onClick={onDismiss}
          style={{ width: "100%", justifyContent: "center", flex: "none" }}
        >
          Back to the game
        </button>
      </section>
    </>
  );
}

function AgeToast({
  toast,
  bundle,
  onDismiss,
}: {
  toast: { age: number; sample: string[] };
  bundle: ThemeBundle;
  onDismiss: () => void;
}) {
  const ageName = bundle.theme.ages[toast.age];
  return (
    <div className="cbdisc cbagetoast" role="status" onClick={onDismiss}>
      <div>
        <span className="k">New age · tap to close</span>
        <b>
          Age {toast.age + 1}: {ageName}
        </b>
        <p>
          New things start arriving. Old ones nobody needs will crumble
          away.
        </p>
        {toast.sample.length > 0 && (
          <div className="cbrcp">
            {toast.sample.map((id) => {
              const it = bundle.items.get(id);
              if (!it) return null;
              return (
                <span key={id}>
                  <Pictogram
                    name={it.name}
                    tier={it.tier}
                    kind={it.kind}
                    symbol={it.symbol}
                  />
                  {cap(it.name)}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DiscoveryToast({
  discovery,
  bundle,
  onDismiss,
}: {
  discovery: { out: string; recipe: string[] };
  bundle: ThemeBundle;
  onDismiss: () => void;
}) {
  const item = bundle.items.get(discovery.out);
  if (!item) return null;
  return (
    <div
      className="cbdisc"
      role="status"
      onClick={onDismiss}
      style={fillVar(item)}
    >
      <Pictogram
        name={item.name}
        tier={item.tier}
        kind={item.kind}
        symbol={item.symbol}
      />
      <div>
        <span className="k">New discovery · tap to close</span>
        <b>{cap(item.name)}</b>
        <div className="cbrcp">
          {discovery.recipe.map((pid, k) => {
            const p = bundle.items.get(pid);
            if (!p) return null;
            return (
              <span key={pid}>
                <Pictogram
                  name={p.name}
                  tier={p.tier}
                  kind={p.kind}
                  symbol={p.symbol}
                />
                {cap(p.name)}
                {k < discovery.recipe.length - 1 && <i>+</i>}
              </span>
            );
          })}
          <i>=</i>
          <span>{cap(item.name)}</span>
        </div>
        {item.fact && <p>{item.fact}</p>}
      </div>
    </div>
  );
}

/* --- Top row: score + helpers (count badges only, menu lands later) --- */

function TopBar({
  state,
  fx,
  helpersOpen,
  onToggleHelpers,
  onHelper,
  onTheme,
}: {
  state: GameState;
  fx: Fx;
  helpersOpen: boolean;
  onToggleHelpers: () => void;
  onHelper: (which: "hint" | "swap" | "clear" | "move") => void;
  onTheme: () => void;
}) {
  const helpersLeft = state.swaps + state.clears + state.hints + state.mv;
  const themeName = state.daily ? "Daily" : state.theme === "everyday" ? "Everyday" : "Everything";
  return (
    <div className="cbtop">
      <div className="cbscore">
        <b>{state.score.toLocaleString("en")}</b>
        <span>best 0</span>
      </div>
      {fx.chain && fx.chain > 1 ? (
        <span className="cbchain" aria-live="polite">
          ×{fx.chain} chain
        </span>
      ) : null}
      {fx.close ? (
        <span className="cbchain cbclose" aria-live="polite">
          Close call! +{fx.close}
        </span>
      ) : null}
      <button
        className="cbh cbtheme"
        type="button"
        aria-label={`Theme: ${themeName}. Change theme`}
        onClick={onTheme}
      >
        <span>{themeName}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div className="cbhelpwrap">
        <button
          className={`cbh${helpersOpen ? " open" : ""}`}
          id="cbHelp"
          type="button"
          aria-haspopup="menu"
          aria-expanded={helpersOpen}
          aria-label="Helpers"
          onClick={onToggleHelpers}
          disabled={state.over || helpersLeft === 0}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 9h18v11H3zM8 9V5h8v4M3 13h18M11 12v3h2v-3" />
          </svg>
          <span className="lbl">Helpers</span>
          <b>{helpersLeft}</b>
        </button>
        {helpersOpen && !state.over && (
          <div className="cbhelpmenu" role="menu" aria-label="Helpers">
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("hint")}
              disabled={state.hints === 0}
              aria-label={`Hint: show one new combo, ${state.hints} left`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
              </svg>
              <span className="nm">
                <b className="t">Hint</b>
                <em>
                  Point out a combo, new ones first. If nothing fits, it teaches a recipe.
                </em>
              </span>
              <b className="c">{state.hints}</b>
            </button>
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("move")}
              disabled
              aria-label={`Move a tile on the board, ${state.mv} left`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
              </svg>
              <span className="nm">
                <b className="t">Move</b>
                <em>
                  Pick up a tile on the board and put it somewhere else. Not a turn.
                </em>
              </span>
              <b className="c">{state.mv}</b>
            </button>
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("swap")}
              disabled={state.swaps === 0}
              aria-label={`Swap the tray, ${state.swaps} left`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7h11l-3-3M17 17H6l3 3" />
              </svg>
              <span className="nm">
                <b className="t">Swap</b>
                <em>Trade your three tiles for three new ones</em>
              </span>
              <b className="c">{state.swaps}</b>
            </button>
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("clear")}
              disabled
              aria-label={`Clear a tile, ${state.clears} left`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 6l4 4M12 8l6-6 4 4-6 6M13 11 4 20" />
              </svg>
              <span className="nm">
                <b className="t">Clear</b>
                <em>Remove one tile from the board</em>
              </span>
              <b className="c">{state.clears}</b>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TipLine({
  state,
  selectedSlot,
  preview,
}: {
  state: GameState;
  selectedSlot: number | null;
  preview: Map<number, Preview>;
}) {
  let tip: string;
  if (state.over) tip = "Game over.";
  else if (state.choosing) tip = "These make more than one thing. Pick one.";
  else if (selectedSlot != null) {
    if (preview.size > 0) {
      tip =
        "Glowing squares make things you've found before. New combos don't glow: try things.";
    } else if (state.found.length) {
      tip =
        "No combo you know of. Try somewhere new, or place it where it can wait.";
    } else {
      tip =
        "Nothing glows until you've found it. Drop it on, or beside, things that might go with it.";
    }
  } else {
    tip =
      "Drag a tile onto the board, or tap it and then a square. Things that touch combine.";
  }
  return (
    <p className="cbtip" aria-live="polite">
      {tip}
    </p>
  );
}

function AgeBar({
  state,
  bundle,
  onBook,
  onSound,
}: {
  state: GameState;
  bundle: ThemeBundle;
  onBook: () => void;
  onSound: () => void;
}) {
  const ages = bundle.theme.ages;
  const last = state.age >= ages.length - 1;
  const need = 6 + 2 * state.age;
  const pct = last ? 100 : Math.min(100, Math.round((state.ageMade / need) * 100));
  const ariaLabel = `Age ${state.age + 1} of ${ages.length}: ${ages[state.age]}${
    last ? "" : `. Make ${need - state.ageMade} more to reach ${ages[state.age + 1]}`
  }`;
  return (
    <div className="cbage" aria-label={ariaLabel}>
      <span className="an">
        <em>Age {state.age + 1}</em>
        <b>{ages[state.age]}</b>
      </span>
      <span className="bar">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="nx">
        {last ? "Final age" : `${state.ageMade}/${need} → ${ages[state.age + 1]}`}
      </span>
      <button
        type="button"
        className="cbsnd"
        aria-label="Collection"
        title="Collection"
        onClick={onBook}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5c3-1 6-1 8 1v14c-2-2-5-2-8-1zM20 5c-3-1-6-1-8 1v14c2-2 5-2 8-1z" />
        </svg>
      </button>
      <button
        type="button"
        className="cbsnd"
        aria-label="Music and sound settings"
        title="Music and sound"
        onClick={onSound}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9h4l5-4v14l-5-4H4z" />
          <path d="M17 9l5 6M22 9l-5 6" />
        </svg>
      </button>
    </div>
  );
}

function Shelf({
  state,
  bundle,
  fx,
  onInfo,
}: {
  state: GameState;
  bundle: ThemeBundle;
  fx: Fx;
  onInfo: (id: string) => void;
}) {
  // Group by output id with a count badge.
  const counts = new Map<string, number>();
  for (const id of state.shelf) counts.set(id, (counts.get(id) ?? 0) + 1);
  const empty = counts.size === 0;
  // The id that just landed on the shelf, so it gets .new.
  const freshlyShipped = fx.shipped
    ? state.shelf[state.shelf.length - 1]
    : null;
  return (
    <div
      className={`cbshelf${empty ? " none" : ""}`}
      aria-label={`Made and shipped: ${state.shelf.length}`}
    >
      {[...counts.entries()].map(([id, n]) => {
        const item = bundle.items.get(id);
        if (!item) return null;
        const isNew = id === freshlyShipped;
        return (
          <button
            key={id}
            type="button"
            className={`cbslot${isNew ? " new" : ""}`}
            style={fillVar(item)}
            aria-label={`${cap(item.name)}${n > 1 ? `, ×${n}` : ""}. Show how it's made`}
            title={cap(item.name)}
            onClick={() => onInfo(id)}
          >
            <Pictogram
              name={item.name}
              tier={item.tier}
              kind={item.kind}
              symbol={item.symbol}
            />
            {n > 1 && <b>{n}</b>}
          </button>
        );
      })}
      <span className="cbslot cbslot-next" aria-hidden="true" />
      {empty && (
        <span className="cbshelf-empty">Finished things land here</span>
      )}
    </div>
  );
}

function Board({
  state,
  bundle,
  fx,
  preview,
  dragOver,
  onCellTap,
}: {
  state: GameState;
  bundle: ThemeBundle;
  fx: Fx;
  preview: Map<number, Preview>;
  dragOver: { cell: number | null; ok: boolean } | null;
  onCellTap: (cell: number) => void;
}) {
  const size = state.n;
  return (
    <div
      className="cbboard"
      style={{ "--cbn": size } as React.CSSProperties}
      role="grid"
      aria-label="Board"
    >
      {state.board.map((v, i) => {
        const crumbleTick =
          v && state.crumb[i]?.id === v ? state.crumb[i]!.n : 0;
        const over =
          dragOver && dragOver.cell === i
            ? dragOver.ok
              ? "ok"
              : "no"
            : null;
        return (
          <Cell
            key={i}
            cell={i}
            id={v}
            bundle={bundle}
            crumbleTick={crumbleTick}
            fx={fx}
            preview={preview.get(i)}
            over={over}
            onTap={() => onCellTap(i)}
          />
        );
      })}
    </div>
  );
}

const CRUMBLE_TTL = 3;

function Cell({
  cell,
  id,
  bundle,
  crumbleTick,
  fx,
  preview,
  over,
  onTap,
}: {
  cell: number;
  id: string | null;
  bundle: ThemeBundle;
  crumbleTick: number;
  fx: Fx;
  preview: Preview | undefined;
  over: "ok" | "no" | null;
  onTap: () => void;
}) {
  const empty = !id;
  const item = id ? bundle.items.get(id) : null;
  const ghostItem = preview?.out ? bundle.items.get(preview.out) : null;

  const inFuse = fx.fuse?.has(cell) ?? false;
  const inCrumble = fx.crumble?.has(cell) ?? false;
  const isPop = fx.pop === cell;
  const isPlaced = fx.placed === cell;
  const isNope = fx.nope === cell;
  const isShipped = fx.shipped?.at === cell;
  const burst = fx.burst?.at === cell ? fx.burst : null;

  const classes = ["cbc"];
  if (!empty) classes.push("full");
  if (isPlaced) classes.push("placed");
  if (inFuse) classes.push("fuse");
  if (isPop) classes.push("cbpopc");
  if (isNope) classes.push("nope");
  if (isShipped) classes.push("ship");
  if (crumbleTick > 0 && !inCrumble) classes.push("crumbling");
  if (inCrumble) classes.push("crumble");
  // Preview classes: empty cells where the selected tile would combine → .can;
  // occupied cells where drop-on-top would combine → .over (via .full.over).
  if (empty && preview) classes.push("can");
  if (!empty && preview?.on) classes.push("over");
  // Drag-ghost over highlighting takes precedence over preview.
  if (over === "ok") classes.push("over");
  if (over === "no") classes.push("overno");

  const words = id ? id.split("-") : [];
  const longest = Math.max(0, ...words.map((w) => w.length));
  const lenClass = longest >= 10 ? " l2" : longest >= 7 ? " l1" : "";

  const ariaLabel = item
    ? `${cap(item.name)}${
        crumbleTick > 0
          ? `, crumbling: nothing in this age uses it, gone in ${CRUMBLE_TTL + 1 - crumbleTick} turns`
          : ""
      }`
    : preview?.out
      ? `Empty. Placing here makes ${cap(preview.out)}`
      : `Empty cell ${cell}`;

  return (
    <button
      type="button"
      className={classes.join(" ")}
      data-cb={cell}
      style={item ? fillVar(item) : undefined}
      onClick={onTap}
      aria-label={ariaLabel}
    >
      {item && (
        <>
          <Pictogram
            name={item.name}
            tier={item.tier}
            kind={item.kind}
            symbol={item.symbol}
          />
          <span className={`cbn${lenClass}`}>{cap(item.name)}</span>
        </>
      )}
      {empty && ghostItem && (
        <>
          <span className="ghost2">
            <Pictogram
              name={ghostItem.name}
              tier={ghostItem.tier}
              kind={ghostItem.kind}
              symbol={ghostItem.symbol}
            />
          </span>
          {preview && preview.n && preview.n > 1 && (
            <span className="alts" aria-hidden="true">
              +{preview.n - 1}
            </span>
          )}
        </>
      )}
      {burst && <span className="pts">+{burst.pts}</span>}
      {isNope && <span className="pts nope">no recipe</span>}
      {isShipped && (
        <span className="pts ship">shipped +{fx.shipped!.bonus}</span>
      )}
      {crumbleTick > 0 && !inCrumble && (
        <span className="crk" aria-hidden="true">
          {CRUMBLE_TTL + 1 - crumbleTick}
        </span>
      )}
    </button>
  );
}

function Tray({
  state,
  bundle,
  selected,
  onSlotTap,
  onSlotPointerDown,
}: {
  state: GameState;
  bundle: ThemeBundle;
  selected: number | null;
  onSlotTap: (slot: number) => void;
  onSlotPointerDown: (
    slot: number,
    e: React.PointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  return (
    <div className="cbtray" aria-label="Tray">
      {state.tray.map((id, slot) => {
        if (id == null) {
          return (
            <div key={slot} className="cbp empty" aria-hidden="true" />
          );
        }
        const item = bundle.items.get(id);
        if (!item) return <div key={slot} className="cbp empty" />;
        const classes = ["cbp"];
        if (selected === slot) classes.push("sel");
        const isTool = bundle.tools.has(id);
        return (
          <button
            key={slot}
            type="button"
            className={classes.join(" ")}
            data-cbp={slot}
            style={fillVar(item)}
            onPointerDown={(e) => onSlotPointerDown(slot, e)}
            onClick={() => onSlotTap(slot)}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={`Tray slot ${slot + 1}: ${cap(item.name)}${selected === slot ? ", selected" : ""}`}
            aria-pressed={selected === slot}
          >
            {isTool && <span className="tool">tool</span>}
            <Pictogram
              name={item.name}
              tier={item.tier}
              kind={item.kind}
              symbol={item.symbol}
            />
            <span className="cbn">{cap(item.name)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ChoicePicker({
  state,
  bundle,
  onChoose,
}: {
  state: GameState;
  bundle: ThemeBundle;
  onChoose: (outputIndex: number) => void;
}) {
  if (!state.choosing) return null;
  const found = (id: string) => state.found.includes(id);
  // Found options first, then unknown ("?") options.
  const indexed = state.choosing.options.map((r, i) => ({ r, i }));
  const sorted = indexed
    .slice()
    .sort(
      (a, b) => Number(found(b.r.out)) - Number(found(a.r.out)),
    );
  return (
    <div className="cbchoose" role="dialog" aria-label="Pick what to make">
      <div className="k">These make more than one thing. Pick one.</div>
      <div className="opts">
        {sorted.map(({ r, i }) => {
          const item = bundle.items.get(r.out);
          const isFound = found(r.out);
          const classes = ["cbopt"];
          if (!isFound) classes.push("unk");
          return (
            <button
              key={r.out}
              type="button"
              className={classes.join(" ")}
              onClick={() => onChoose(i)}
              style={item && isFound ? fillVar(item) : undefined}
            >
              {isFound && item ? (
                <>
                  <Pictogram
                    name={item.name}
                    tier={item.tier}
                    kind={item.kind}
                    symbol={item.symbol}
                  />
                  <span>{cap(item.name)}</span>
                </>
              ) : (
                <>
                  <b>?</b>
                  <span>Something new</span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function fillVar(item: CombineItem): React.CSSProperties {
  // Pastel tier fill, with --pk left as the global ink colour — matches the
  // prototype's `icon()` which only sets --fill. Borders and drop shadows
  // on .cbc.full / .cbp are already keyed to --pk through the stylesheet.
  return { "--fill": `var(--f${item.tier})` } as React.CSSProperties;
}

