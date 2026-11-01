"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import { newGame, reduce } from "@/combine/engine";
import type { Action, Event, GameState } from "@/combine/engine";
import { matchAt, matchOn } from "@/combine/match";
import { hydrateBundle, type SerialisedBundle } from "@/combine/serialise";
import type { CombineItem, CombineRecipe, ThemeBundle } from "@/combine/types";
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
        }
      }
      if (latestDiscovery) {
        setDiscovery(latestDiscovery);
        const id = window.setTimeout(() => setDiscovery(null), 4600);
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

  const onSlotTap = useCallback((slot: number) => {
    setSelectedSlot((s) => (s === slot ? null : slot));
  }, []);

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
        />
        <TipLine state={state} selectedSlot={selectedSlot} />
        <AgeBar state={state} bundle={bundle} />
        <Shelf state={state} bundle={bundle} fx={fx} />
        <Board
          state={state}
          bundle={bundle}
          selectedSlot={selectedSlot}
          fx={fx}
          preview={preview}
          onCellTap={onCellTap}
        />
        <Tray
          state={state}
          bundle={bundle}
          selected={selectedSlot}
          onSlotTap={onSlotTap}
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
        {discovery && (
          <DiscoveryToast
            discovery={discovery}
            bundle={bundle}
            onDismiss={() => setDiscovery(null)}
          />
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
}: {
  state: GameState;
  fx: Fx;
  helpersOpen: boolean;
  onToggleHelpers: () => void;
  onHelper: (which: "hint" | "swap" | "clear" | "move") => void;
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
        disabled
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
}: {
  state: GameState;
  selectedSlot: number | null;
}) {
  let tip: string;
  if (state.over) tip = "Game over.";
  else if (state.choosing)
    tip = "These make more than one thing. Pick one.";
  else if (selectedSlot != null) {
    // Phase 3C adds ghost-preview-based tips (Nothing glows / Glowing squares
    // make things you've found before / etc.). For now the single-tile tip.
    tip = state.found.length
      ? "Glowing squares make things you've found before. New combos don't glow: try things."
      : "Nothing glows until you've found it. Drop it on, or beside, things that might go with it.";
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

function AgeBar({ state, bundle }: { state: GameState; bundle: ThemeBundle }) {
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
        disabled
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
        disabled
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
}: {
  state: GameState;
  bundle: ThemeBundle;
  fx: Fx;
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
            disabled
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
  selectedSlot,
  fx,
  preview,
  onCellTap,
}: {
  state: GameState;
  bundle: ThemeBundle;
  selectedSlot: number | null;
  fx: Fx;
  preview: Map<number, Preview>;
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
        return (
          <Cell
            key={i}
            cell={i}
            id={v}
            bundle={bundle}
            selectedSlot={selectedSlot}
            crumbleTick={crumbleTick}
            fx={fx}
            preview={preview.get(i)}
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
  selectedSlot,
  crumbleTick,
  fx,
  preview,
  onTap,
}: {
  cell: number;
  id: string | null;
  bundle: ThemeBundle;
  selectedSlot: number | null;
  crumbleTick: number;
  fx: Fx;
  preview: Preview | undefined;
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
      disabled={empty && selectedSlot == null}
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
}: {
  state: GameState;
  bundle: ThemeBundle;
  selected: number | null;
  onSlotTap: (slot: number) => void;
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
            style={fillVar(item)}
            onClick={() => onSlotTap(slot)}
            aria-label={`Tray slot ${slot + 1}: ${cap(item.name)}${selected === slot ? ", selected" : ""}`}
            aria-pressed={selected === slot}
          >
            {isTool && <span className="tool">Tool</span>}
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

