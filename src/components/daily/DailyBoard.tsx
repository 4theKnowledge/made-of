"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type {
  DailyItem,
  DailyNeighbour,
  DailyPuzzle,
  GameState,
  MoveResponse,
} from "./types";
import { EMPTY_GAME } from "./types";
import { cap } from "@/lib/taxonomy";

/**
 * Client-side daily game.
 *
 * The server owns the answer path. All moves go through /api/daily/move,
 * which returns {ok, done, delta, neighbours}. The client only persists
 * what's safe to lose on refresh (path, deltas, hints) into localStorage.
 */
export function DailyBoard({
  puzzle,
  startNeighbours,
}: {
  puzzle: DailyPuzzle;
  /** Pre-fetched neighbours of the start item (SSR hop, saves one roundtrip). */
  startNeighbours: DailyNeighbour[];
}) {
  const storageKey = `madeof:daily:${puzzle.date}`;

  const [game, setGame] = useState<GameState>(() => ({
    ...EMPTY_GAME,
    path: [puzzle.start.code],
  }));
  const [current, setCurrent] = useState<DailyItem>(puzzle.start);
  const [neighbours, setNeighbours] =
    useState<DailyNeighbour[]>(startNeighbours);
  const [giveUpSteps, setGiveUpSteps] = useState<DailyItem[] | null>(null);
  const [hintMsg, setHintMsg] = useState<string>("");
  const [moving, setMoving] = useState(false);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        path?: string[];
        deltas?: GameState["deltas"];
        hintCodes?: string[];
        gaveUp?: boolean;
        done?: boolean;
      } | null;
      if (!saved?.path || saved.path[0] !== puzzle.start.code) return;
      setGame({
        path: saved.path,
        deltas: saved.deltas ?? [],
        hintCodes: saved.hintCodes ?? [],
        gaveUp: saved.gaveUp ?? false,
        done: saved.done ?? false,
      });
      if (saved.path.length > 1) {
        void refreshFrom(saved.path[saved.path.length - 1]);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshFrom = useCallback(
    async (atCode: string) => {
      const res = await fetch("/api/daily/neighbours", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ at: atCode, date: puzzle.date }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        arrived: DailyItem;
        neighbours: DailyNeighbour[];
      };
      setCurrent(body.arrived);
      setNeighbours(body.neighbours);
    },
    [puzzle.date],
  );

  // Persist whenever game changes.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(game));
    } catch {
      /* ignore */
    }
  }, [game, storageKey]);

  const moves = game.path.length - 1;

  const doMove = useCallback(
    async (next: DailyNeighbour) => {
      if (moving || game.done) return;
      setMoving(true);
      setHintMsg("");
      try {
        const res = await fetch("/api/daily/move", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            from: current.code,
            to: next.code,
            date: puzzle.date,
          }),
        });
        const body = (await res.json()) as MoveResponse;
        if (!body.ok) {
          if (body.reason === "closed") {
            setHintMsg(
              `${cap(body.name ?? next.name)} is a busy hub, so it's closed in puzzles. Find another way.`,
            );
          } else {
            setHintMsg("That isn't a direct link.");
          }
          return;
        }
        if (!body.arrived || !body.neighbours || !body.delta) return;
        setCurrent(body.arrived);
        setNeighbours(body.neighbours);
        setGame((g) => ({
          ...g,
          path: [...g.path, body.arrived!.code],
          deltas: [...g.deltas, body.delta!],
          done: Boolean(body.done),
        }));
      } finally {
        setMoving(false);
      }
    },
    [current.code, game.done, moving, puzzle.date],
  );

  const doUndo = useCallback(async () => {
    if (moves === 0 || game.done) return;
    const newPath = game.path.slice(0, -1);
    const newDeltas = game.deltas.slice(0, -1);
    const prevCode = newPath[newPath.length - 1];
    setMoving(true);
    setHintMsg("");
    try {
      await refreshFrom(prevCode);
      setGame({
        path: newPath,
        deltas: newDeltas,
        hintCodes: game.hintCodes,
        gaveUp: false,
        done: false,
      });
    } finally {
      setMoving(false);
    }
  }, [game, moves, refreshFrom]);

  const doHint = useCallback(async () => {
    if (game.done) return;
    try {
      const res = await fetch("/api/daily/hint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: current.code, date: puzzle.date }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        hint: { code: string; name: string } | null;
      };
      if (!body.hint) return;
      setGame((g) => ({
        ...g,
        hintCodes: [...g.hintCodes, body.hint!.code],
      }));
      setHintMsg(`Head for ${body.hint.name}.`);
    } catch {
      /* ignore */
    }
  }, [current.code, game.done, puzzle.date]);

  const doGiveUp = useCallback(async () => {
    try {
      const res = await fetch("/api/daily/giveup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: puzzle.date }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        steps: Array<{
          code: string;
          name: string;
          tier: DailyItem["tier"];
          kind: DailyItem["kind"];
          symbol: string | null;
        }>;
      };
      setGiveUpSteps(body.steps);
      setGame((g) => ({ ...g, gaveUp: true, done: true }));
    } catch {
      /* ignore */
    }
  }, [puzzle.date]);

  const squares = useMemo(() => {
    const marks = game.deltas.map((d) =>
      d === "closer" ? "g" : d === "same" ? "y" : "r",
    );
    return marks.join("");
  }, [game.deltas]);

  const shareText = useMemo(() => {
    const squaresPlain = game.deltas
      .map((d) => (d === "closer" ? "▲" : d === "same" ? "●" : "▼"))
      .join("");
    const hintSuffix = game.hintCodes.length
      ? ` · ${game.hintCodes.length} hint${game.hintCodes.length > 1 ? "s" : ""}`
      : "";
    return [
      `Made Of · Daily link #${puzzle.number}`,
      `${cap(puzzle.start.name)} → ${cap(puzzle.goal.name)}`,
      `${moves} moves (par ${puzzle.par})`,
      squaresPlain + hintSuffix,
    ].join("\n");
  }, [
    game.deltas,
    game.hintCodes.length,
    moves,
    puzzle.goal.name,
    puzzle.number,
    puzzle.par,
    puzzle.start.name,
  ]);

  // Trail of names walked so far.
  const trailNames = useMemo(() => {
    // We only have codes in game.path; the current name is in `current`.
    // Build a label list by swapping codes we know for their names.
    const nameByCode = new Map<string, string>();
    nameByCode.set(puzzle.start.code, puzzle.start.name);
    nameByCode.set(current.code, current.name);
    return game.path.map((c) => nameByCode.get(c) ?? "…");
  }, [current.code, current.name, game.path, puzzle.start.code, puzzle.start.name]);

  return (
    <>
      <section className="pbar" aria-live="polite">
        <div className="pmeta">Daily link #{puzzle.number}</div>
        <div className="pgoal">
          <ChipSpan item={puzzle.start} />
          <svg
            width="40"
            height="14"
            viewBox="0 0 40 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M1 7h36M32 2l5 5-5 5" />
          </svg>
          <span className="pdown" aria-hidden="true">
            ↓
          </span>
          <ChipSpan item={puzzle.goal} />
        </div>
        <div className="pstats">
          <span>
            <b>{moves}</b>moves
          </span>
          <span>
            <b>{puzzle.par}</b>par
          </span>
          <span>
            <b>{game.hintCodes.length}</b>hints
          </span>
        </div>
        <div className="pbtns">
          <button
            className="btn"
            type="button"
            onClick={doHint}
            disabled={game.done}
          >
            Hint
          </button>
          <button
            className="btn"
            type="button"
            onClick={doUndo}
            disabled={game.done || moves === 0}
          >
            Undo
          </button>
          <button
            className="btn"
            type="button"
            onClick={doGiveUp}
            disabled={game.done}
          >
            Show me the way
          </button>
          <p className="msg">
            {hintMsg ||
              (game.done
                ? ""
                : `Move one link at a time, upstream or downstream, until you reach ${puzzle.goal.name}. Busy hubs like water and steel, and the elements, are closed.`)}
          </p>
        </div>
      </section>

      <div className="trail">
        {trailNames.map((n, i) => (
          <span key={`${n}-${i}`} className={i === trailNames.length - 1 ? "now" : ""}>
            {i > 0 ? <span aria-hidden="true">› </span> : null}
            {cap(n)}
          </span>
        ))}
      </div>

      <section className="panel">
        <h3>From {cap(current.name)}</h3>
        <p className="sub">
          Pick a neighbour. Green closer, yellow same distance, red further.
        </p>
        <div className="cs">
          {neighbours.length === 0 ? (
            <p className="empty">
              {moves === 0
                ? ""
                : "Neighbours refresh on your next move. (Undo clears them.)"}
            </p>
          ) : (
            neighbours.map((nb) => (
              <button
                key={nb.code}
                type="button"
                className={`chip sm${nb.closed ? " closed" : ""}${nb.isGoal ? " target" : ""}${game.hintCodes.includes(nb.code) ? " hint" : ""}`}
                onClick={() => doMove(nb)}
                disabled={moving || game.done}
                aria-disabled={nb.closed}
                title={nb.closed ? "Closed in puzzles" : undefined}
              >
                <Pictogram
                  name={nb.name}
                  tier={nb.tier}
                  kind={nb.kind}
                  symbol={nb.symbol}
                  className="sm"
                />
                <span className="nm">{nb.name}</span>
              </button>
            ))
          )}
        </div>
      </section>

      {game.done && !game.gaveUp && (
        <section className="panel">
          <h3>
            {moves <= puzzle.par
              ? game.hintCodes.length > 0
                ? "Par, with a little help."
                : "Perfect. You matched par."
              : moves <= puzzle.par + 2
                ? "Nicely done."
                : "You got there."}{" "}
            {cap(puzzle.start.name)} to {puzzle.goal.name} in {moves}{" "}
            {moves === 1 ? "move" : "moves"}.
          </h3>
          <div
            className="squares"
            aria-label="Green: got closer. Yellow: same distance. Red: moved away."
          >
            {squares.split("").map((c, i) => (
              <i key={i} className={`sq ${c}`} />
            ))}
            {game.hintCodes.length > 0 ? (
              <span className="sqh">
                +{game.hintCodes.length} hint
                {game.hintCodes.length > 1 ? "s" : ""}
              </span>
            ) : null}
          </div>
          <pre className="share">{shareText}</pre>
          <div className="row">
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(shareText).catch(() => undefined);
              }}
            >
              Copy result
            </button>
          </div>
        </section>
      )}

      {game.done && game.gaveUp && giveUpSteps && (
        <section className="panel">
          <h3>
            One shortest way from {cap(puzzle.start.name)} to {puzzle.goal.name}
          </h3>
          <div className="chain">
            {giveUpSteps.map((s, i) => (
              <div key={s.code} className={`node${i === giveUpSteps.length - 1 ? " end" : ""}`}>
                <Pictogram
                  name={s.name}
                  tier={s.tier}
                  kind={s.kind}
                  symbol={s.symbol}
                  className="sm"
                />
                <span className="tx">
                  <span className="v">{s.name}</span>
                </span>
                {i < giveUpSteps.length - 1 ? <span className="arr">›</span> : null}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ChipSpan({ item }: { item: DailyItem }) {
  return (
    <span className="chip">
      <Pictogram
        name={item.name}
        tier={item.tier}
        kind={item.kind}
        symbol={item.symbol}
      />
      <span className="nm">{item.name}</span>
    </span>
  );
}
