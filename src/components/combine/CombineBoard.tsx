"use client";

import { useCallback, useMemo, useState } from "react";
import type React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import { newGame, reduce } from "@/combine/engine";
import type { Action, GameState } from "@/combine/engine";
import { hydrateBundle, type SerialisedBundle } from "@/combine/serialise";
import type { CombineItem, ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";

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
  const [nopeCell, setNopeCell] = useState<number | null>(null);

  // Apply an action: run reduce once, read events, then set the new state.
  const act = useCallback(
    (action: Action) => {
      const r = reduce(state, bundle, action);
      if (r.events.some((e) => e.type === "nope")) {
        const target = action.type === "drop-on" ? action.cell : null;
        setNopeCell(target);
        setTimeout(() => setNopeCell(null), 350);
      }
      setState(r.state);
      setSelectedSlot(null);
    },
    [state, bundle],
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

  return (
    <div className="cbwrap">
      <div id="cb">
        <TopBar state={state} />
        <TipLine state={state} selectedSlot={selectedSlot} />
        <AgeBar state={state} bundle={bundle} />
        <Shelf state={state} bundle={bundle} />
        <Board
          state={state}
          bundle={bundle}
          selectedSlot={selectedSlot}
          nopeCell={nopeCell}
          onCellTap={onCellTap}
        />
        <Tray
          state={state}
          bundle={bundle}
          selected={selectedSlot}
          onSlotTap={onSlotTap}
        />
        {state.choosing && (
          <ChoicePicker
            state={state}
            bundle={bundle}
            onChoose={onChoose}
          />
        )}
      </div>
    </div>
  );
}

/* --- Top row: score + helpers (count badges only, menu lands later) --- */

function TopBar({ state }: { state: GameState }) {
  const helpersLeft = state.swaps + state.clears + state.hints + state.mv;
  return (
    <div className="cbtop">
      <div className="cbscore">
        <b>{state.score.toLocaleString("en")}</b>
        <span>best 0</span>
      </div>
      <button className="cbh cbtheme" type="button" disabled>
        <span>Everyday</span>
      </button>
      <button className="cbh" type="button" disabled>
        <span className="lbl">Helpers</span>
        <b>{helpersLeft}</b>
      </button>
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
  else if (state.choosing) tip = "These make more than one thing. Pick one.";
  else if (selectedSlot != null)
    tip = "Tap a square to place, or tap a tile to combine on top.";
  else tip = "Tap a tray tile to pick it up.";
  return <p className="cbtip" aria-live="polite">{tip}</p>;
}

function AgeBar({ state, bundle }: { state: GameState; bundle: ThemeBundle }) {
  const ages = bundle.theme.ages;
  const need = 6 + 2 * state.age;
  const next = state.age < ages.length - 1 ? ages[state.age + 1] : null;
  const pct = Math.min(100, Math.round((state.ageMade / need) * 100));
  return (
    <div className="cbage">
      <div className="an">
        <em>Age {state.age + 1}</em>
        <b>{ages[state.age]}</b>
      </div>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      {next ? (
        <div className="nx">
          {state.ageMade}/{need} → {next}
        </div>
      ) : (
        <div className="nx">Final age</div>
      )}
    </div>
  );
}

function Shelf({ state, bundle }: { state: GameState; bundle: ThemeBundle }) {
  // Group by output id with a count badge.
  const counts = new Map<string, number>();
  for (const id of state.shelf) counts.set(id, (counts.get(id) ?? 0) + 1);
  if (counts.size === 0) {
    return (
      <div className="cbshelf" aria-label="Shelf">
        <span className="cbshelf-empty">
          Finished things land here.
        </span>
      </div>
    );
  }
  return (
    <div className="cbshelf" aria-label="Shelf">
      {[...counts.entries()].map(([id, n]) => {
        const item = bundle.items.get(id);
        if (!item) return null;
        return (
          <div
            key={id}
            className="cbslot"
            style={fillVar(item)}
            title={cap(item.name)}
          >
            <Pictogram
              name={item.name}
              tier={item.tier}
              kind={item.kind}
              symbol={item.symbol}
            />
            {n > 1 && <b>×{n}</b>}
          </div>
        );
      })}
    </div>
  );
}

function Board({
  state,
  bundle,
  selectedSlot,
  nopeCell,
  onCellTap,
}: {
  state: GameState;
  bundle: ThemeBundle;
  selectedSlot: number | null;
  nopeCell: number | null;
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
      {state.board.map((v, i) => (
        <Cell
          key={i}
          cell={i}
          id={v}
          bundle={bundle}
          selectedSlot={selectedSlot}
          nope={nopeCell === i}
          onTap={() => onCellTap(i)}
        />
      ))}
    </div>
  );
}

function Cell({
  cell,
  id,
  bundle,
  selectedSlot,
  nope,
  onTap,
}: {
  cell: number;
  id: string | null;
  bundle: ThemeBundle;
  selectedSlot: number | null;
  nope: boolean;
  onTap: () => void;
}) {
  const empty = !id;
  const item = id ? bundle.items.get(id) : null;
  const classes = ["cbc"];
  if (!empty) classes.push("full");
  if (nope) classes.push("nope");
  const words = id ? id.split("-") : [];
  const longest = Math.max(0, ...words.map((w) => w.length));
  const lenClass = longest >= 10 ? " l2" : longest >= 7 ? " l1" : "";
  return (
    <button
      type="button"
      className={classes.join(" ")}
      data-cb={cell}
      style={item ? fillVar(item) : undefined}
      onClick={onTap}
      aria-label={
        item ? `${cap(item.name)} at cell ${cell}` : `Empty cell ${cell}`
      }
      disabled={empty && selectedSlot == null}
    >
      {item ? (
        <>
          <Pictogram
            name={item.name}
            tier={item.tier}
            kind={item.kind}
            symbol={item.symbol}
          />
          <span className={`cbn${lenClass}`}>{cap(item.name)}</span>
        </>
      ) : null}
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
  // Reuse the tier-fill variables defined in globals.css (--fF, --fN, …).
  return {
    "--fill": `var(--f${item.tier})`,
    "--pk": `var(--t${item.tier})`,
  } as React.CSSProperties;
}

