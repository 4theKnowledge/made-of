"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import { Bowtie } from "@/components/bowtie/Bowtie";
import { flyPictogram } from "@/components/bowtie/fly";
import { cap } from "@/lib/taxonomy";
import type { ExploreView } from "@/components/explore/types";
import type { DailyPuzzle, GameState, MoveResponse } from "./types";
import { EMPTY_GAME } from "./types";

/**
 * The daily game, rendered as the shared Bowtie plus a puzzle bar.
 *
 * - Server owns the answer path. Every move goes through /api/daily/move.
 * - Chip click fires a move; closed/target/hint markers come from state.
 * - After each move we fetch /api/view/<arrivedCode> to render the next
 *   bowtie around the new current item.
 */
export function DailyBoard({
  puzzle,
  initialView,
}: {
  puzzle: DailyPuzzle;
  initialView: ExploreView;
}) {
  const storageKey = `madeof:daily:${puzzle.date}`;

  const [view, setView] = useState<ExploreView>(initialView);
  const [game, setGame] = useState<GameState>(() => ({
    ...EMPTY_GAME,
    path: [puzzle.start.code],
  }));
  const [hintMsg, setHintMsg] = useState<string>("");
  const [moving, setMoving] = useState(false);
  const [giveUpSteps, setGiveUpSteps] = useState<ExploreView["originChain"] | null>(null);
  const [hintCodes, setHintCodes] = useState<Set<string>>(new Set());

  // Fly-ghost rect sources, captured on chip click.
  const flyFromRef = useRef<HTMLElement | null>(null);
  const focusHeadRef = useRef<HTMLDivElement | null>(null);

  // Hydrate from localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as GameState | null;
      if (!saved?.path || saved.path[0] !== puzzle.start.code) return;
      setGame(saved);
      setHintCodes(new Set(saved.hintCodes));
      if (saved.path.length > 1) {
        void loadView(saved.path[saved.path.length - 1]);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on game change.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(game));
    } catch {
      /* ignore */
    }
  }, [game, storageKey]);

  const loadView = useCallback(async (code: string) => {
    const res = await fetch(`/api/view/${code}`);
    if (!res.ok) return;
    const body = (await res.json()) as ExploreView;
    setView(body);
  }, []);

  const closedCodes = useMemo(() => {
    // The server tells us per-neighbour "closed" via /api/daily/move result.
    // For the bowtie we need every potentially-closed neighbour marked
    // whether we've visited it or not. The simplest route: hit
    // /api/daily/neighbours when the bowtie changes to get the flags, then
    // merge. But /api/daily/neighbours uses the daily-rate limiter and
    // charges per hop. For now we build the set lazily by prefetching
    // closed flags on view load. Phase 3 polish: include closed/isGoal in
    // the view payload directly.
    void view;
    return new Set<string>();
  }, [view]);

  // Keep a live cache of closed-neighbour codes for the current view.
  const [closedFromServer, setClosedFromServer] = useState<Set<string>>(
    new Set(),
  );
  useEffect(() => {
    // Fetch per-view closed flags once per focus change.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/daily/neighbours", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ at: view.item.code, date: puzzle.date }),
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          neighbours: Array<{ code: string; closed: boolean }>;
        };
        if (cancelled) return;
        setClosedFromServer(
          new Set(body.neighbours.filter((n) => n.closed).map((n) => n.code)),
        );
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view.item.code, puzzle.date]);

  const effectiveClosed = useMemo(() => {
    const out = new Set(closedFromServer);
    for (const c of closedCodes) out.add(c);
    return out;
  }, [closedCodes, closedFromServer]);

  const moves = game.path.length - 1;

  const onChipClick = useCallback(
    async (targetCode: string, chipEl: HTMLElement) => {
      if (moving || game.done) return;

      flyFromRef.current = chipEl;
      setMoving(true);
      setHintMsg("");

      try {
        const res = await fetch("/api/daily/move", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            from: view.item.code,
            to: targetCode,
            date: puzzle.date,
          }),
        });
        const body = (await res.json()) as MoveResponse;
        if (!body.ok) {
          if (body.reason === "closed") {
            setHintMsg(
              `${cap(body.name ?? "That item")} is a busy hub, so it's closed in puzzles. Find another way.`,
            );
          } else {
            setHintMsg("That isn't a direct link.");
          }
          return;
        }
        if (!body.arrived || !body.delta) return;

        // Pluck the chip's pictogram tile before the view swaps away.
        const srcIc = chipEl.querySelector<HTMLElement>(".ic");

        await loadView(body.arrived.code);

        // Delightful: hide the fresh focus head, fly the pictogram ghost in,
        // then fade the real head back in.
        requestAnimationFrame(() => {
          const head = focusHeadRef.current?.querySelector<HTMLElement>(".fpic .ic");
          const headWrap = focusHeadRef.current?.querySelector<HTMLElement>(".fhead");
          if (!head || !headWrap) return;
          headWrap.style.visibility = "hidden";
          flyPictogram(srcIc, head.getBoundingClientRect()).then(() => {
            headWrap.style.visibility = "";
            try {
              headWrap.animate(
                [{ opacity: 0.3 }, { opacity: 1 }],
                { duration: 180 },
              );
            } catch {
              /* animate() unsupported */
            }
          });
        });

        setGame((g) => ({
          ...g,
          path: [...g.path, body.arrived!.code],
          deltas: [...g.deltas, body.delta!],
          done: Boolean(body.done),
        }));
        setHintCodes(new Set());
      } finally {
        setMoving(false);
      }
    },
    [game.done, loadView, moving, puzzle.date, view.item.code],
  );

  const doUndo = useCallback(async () => {
    if (moves === 0 || game.done) return;
    const newPath = game.path.slice(0, -1);
    const newDeltas = game.deltas.slice(0, -1);
    const prevCode = newPath[newPath.length - 1];
    setMoving(true);
    setHintMsg("");
    try {
      await loadView(prevCode);
      setGame({
        path: newPath,
        deltas: newDeltas,
        hintCodes: game.hintCodes,
        gaveUp: false,
        done: false,
      });
      setHintCodes(new Set());
    } finally {
      setMoving(false);
    }
  }, [game, loadView, moves]);

  const doHint = useCallback(async () => {
    if (game.done) return;
    try {
      const res = await fetch("/api/daily/hint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: view.item.code, date: puzzle.date }),
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
      setHintCodes((s) => {
        const next = new Set(s);
        next.add(body.hint!.code);
        return next;
      });
      setHintMsg(`Head for ${body.hint.name}.`);
    } catch {
      /* ignore */
    }
  }, [game.done, puzzle.date, view.item.code]);

  const doGiveUp = useCallback(async () => {
    try {
      const res = await fetch("/api/daily/giveup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: puzzle.date }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { steps: ExploreView["originChain"] };
      setGiveUpSteps(body.steps);
      setGame((g) => ({ ...g, gaveUp: true, done: true }));
    } catch {
      /* ignore */
    }
  }, [puzzle.date]);

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

  // Trail of names from path codes. We have names for puzzle.start, puzzle.goal
  // and view.item.name (current); intermediate names aren't persisted in state,
  // so the trail is "start › … › current".
  const trail = useMemo(() => {
    if (game.path.length <= 1) return [puzzle.start.name];
    if (game.path.length === 2)
      return [puzzle.start.name, view.item.name];
    return [
      puzzle.start.name,
      ...Array(game.path.length - 2).fill("…"),
      view.item.name,
    ];
  }, [game.path.length, puzzle.start.name, view.item.name]);

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

      <nav className="trail" aria-label="Your path">
        {trail.map((n, i) => (
          <span
            key={`${n}-${i}`}
            className={i === trail.length - 1 ? "now" : ""}
          >
            {i > 0 ? <span aria-hidden="true">› </span> : null}
            {cap(n)}
          </span>
        ))}
      </nav>

      {/* Hidden handle for the focus-head rect used by the fly-ghost. */}
      <div ref={focusHeadRef} style={{ display: "contents" }}>
        <Bowtie
          view={view}
          mode="daily"
          daily={{
            goalCode: puzzle.goal.code,
            closedCodes: effectiveClosed,
            hintCodes,
          }}
          onChipClick={onChipClick}
        />
      </div>

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
            {game.deltas.map((d, i) => (
              <i
                key={i}
                className={`sq ${d === "closer" ? "g" : d === "same" ? "y" : "r"}`}
              />
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
              <div
                key={s.slug}
                className={`node${i === giveUpSteps.length - 1 ? " end" : ""}`}
              >
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
                {i < giveUpSteps.length - 1 ? (
                  <span className="arr">›</span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ChipSpan({
  item,
}: {
  item: { name: string; tier: DailyPuzzle["start"]["tier"]; kind: DailyPuzzle["start"]["kind"]; symbol: string | null };
}) {
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
