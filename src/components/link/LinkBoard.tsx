"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Pictogram } from "@/pictograms/Pictogram";
import { Bowtie } from "@/components/bowtie/Bowtie";
import { flyPictogram } from "@/components/bowtie/fly";
import { cap } from "@/lib/taxonomy";
import type { ExploreView } from "@/components/explore/types";
import type {
  DailyPuzzle,
  GameState,
  MoveResponse,
  PathStep,
} from "./types";
import { EMPTY_GAME } from "./types";
import { HelpButton, HowToPlay } from "@/components/common/HowToPlay";
import { LinkModeDialog } from "./LinkModeDialog";

/**
 * The daily game, rendered as the shared Bowtie plus a puzzle bar.
 *
 * - Server owns the answer path. Every move goes through /api/link/move.
 * - Chip click fires a move; closed/target/hint markers come from state.
 * - After each move we fetch /api/view/<arrivedCode> to render the next
 *   bowtie around the new current item.
 */
export function LinkBoard({
  puzzle,
  initialView,
  onNewFreePlay,
}: {
  puzzle: DailyPuzzle;
  initialView: ExploreView;
  /** When set, Free play's mode dialog shows a "pick a new pair" action. */
  onNewFreePlay?: () => void;
}) {
  const isFree = puzzle.ref.kind === "free";
  const storageKey =
    puzzle.ref.kind === "daily"
      ? `madeof:daily:${puzzle.ref.date}`
      : `madeof:link:free:${puzzle.ref.start}:${puzzle.ref.goal}`;

  // Server-side puzzle-ref body that every /api/link/* call includes.
  // Memoised so the useEffect/useCallback deps don't thrash on re-render.
  const refBody = useMemo(
    () =>
      puzzle.ref.kind === "daily"
        ? { date: puzzle.ref.date }
        : { free: { start: puzzle.ref.start, goal: puzzle.ref.goal } },
    [puzzle.ref],
  );
  const refKey =
    puzzle.ref.kind === "daily"
      ? puzzle.ref.date
      : `${puzzle.ref.start}>${puzzle.ref.goal}`;

  const startStep: PathStep = {
    code: puzzle.start.code,
    name: puzzle.start.name,
  };

  const [view, setView] = useState<ExploreView>(initialView);
  const [game, setGame] = useState<GameState>(() => ({
    ...EMPTY_GAME,
    path: [startStep],
  }));
  const [hintMsg, setHintMsg] = useState<string>("");
  const [moving, setMoving] = useState(false);
  const [giveUpSteps, setGiveUpSteps] = useState<ExploreView["originChain"] | null>(null);
  const [copyMsg, setCopyMsg] = useState<string>("");
  const [helpOpen, setHelpOpen] = useState<boolean>(false);
  const [modeOpen, setModeOpen] = useState<boolean>(false);

  // Fly-ghost rect sources, captured on chip click.
  const focusHeadRef = useRef<HTMLDivElement | null>(null);

  // Hydrate from localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as GameState | null;
      if (!saved?.path?.length) return;
      // Backwards-compat: old shape stored string codes.
      const first = saved.path[0];
      if (typeof first === "string") return;
      if (first.code !== puzzle.start.code) return;
      setGame(saved);
      if (saved.path.length > 1) {
        void loadView(saved.path[saved.path.length - 1].code);
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

  // Keep a live cache of closed-neighbour codes for the current view.
  const [closedFromServer, setClosedFromServer] = useState<Set<string>>(
    new Set(),
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/link/neighbours", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ at: view.item.code, ...refBody }),
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
  }, [view.item.code, refBody, refKey]);

  const moves = game.path.length - 1;

  const onChipClick = useCallback(
    async (targetCode: string, chipEl: HTMLElement) => {
      if (moving || game.done) return;

      setMoving(true);
      setHintMsg("");

      try {
        const res = await fetch("/api/link/move", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            from: view.item.code,
            to: targetCode,
            ...refBody,
          }),
        });
        const body = (await res.json()) as MoveResponse;
        if (!body.ok) {
          if (body.reason === "closed") {
            setHintMsg(
              `${cap(body.name ?? "That item")} is a busy hub, so it's closed in puzzles. Find another way.`,
            );
            // Retrigger the .nope shake, matching prototype.
            chipEl.classList.remove("nope");
            // Force reflow so the keyframes restart.
            void chipEl.offsetWidth;
            chipEl.classList.add("nope");
          } else {
            setHintMsg("That isn't a direct link.");
          }
          return;
        }
        if (!body.arrived || !body.delta) return;

        const srcIc = chipEl.querySelector<HTMLElement>(".ic");

        await loadView(body.arrived.code);

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

        const arrived = body.arrived;
        setGame((g) => ({
          ...g,
          path: [...g.path, { code: arrived.code, name: arrived.name }],
          deltas: [...g.deltas, body.delta!],
          lastHintCode: null,
          done: Boolean(body.done),
        }));
      } finally {
        setMoving(false);
      }
    },
    [game.done, loadView, moving, refBody, view.item.code],
  );

  const doUndo = useCallback(async () => {
    if (moves === 0 || game.done) return;
    const newPath = game.path.slice(0, -1);
    const newDeltas = game.deltas.slice(0, -1);
    const prev = newPath[newPath.length - 1];
    setMoving(true);
    setHintMsg("");
    try {
      await loadView(prev.code);
      setGame((g) => ({
        ...g,
        path: newPath,
        deltas: newDeltas,
        lastHintCode: null,
        gaveUp: false,
        done: false,
      }));
    } finally {
      setMoving(false);
    }
  }, [game, loadView, moves]);

  const doHint = useCallback(async () => {
    if (game.done) return;
    try {
      const res = await fetch("/api/link/hint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: view.item.code, ...refBody }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        hint: { code: string; name: string; recipeLabel: string | null } | null;
      };
      if (!body.hint) return;
      const hint = body.hint;
      setGame((g) => ({
        ...g,
        hintCodes: g.hintCodes.includes(hint.code)
          ? g.hintCodes
          : [...g.hintCodes, hint.code],
        lastHintCode: hint.code,
      }));
      setHintMsg(
        hint.recipeLabel
          ? `Head for ${hint.name}. It's in the "${hint.recipeLabel}" recipe.`
          : `Head for ${hint.name}.`,
      );
    } catch {
      /* ignore */
    }
  }, [game.done, refBody, view.item.code]);

  const doGiveUp = useCallback(async () => {
    try {
      const res = await fetch("/api/link/giveup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(refBody),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { steps: ExploreView["originChain"] };
      setGiveUpSteps(body.steps);
      setGame((g) => ({ ...g, gaveUp: true, done: true }));
    } catch {
      /* ignore */
    }
  }, [refBody]);

  const shareText = useMemo(() => {
    const squaresPlain = game.deltas
      .map((d) => (d === "closer" ? "▲" : d === "same" ? "●" : "▼"))
      .join("");
    const hintSuffix = game.hintCodes.length
      ? ` · ${game.hintCodes.length} hint${game.hintCodes.length > 1 ? "s" : ""}`
      : "";
    const url = typeof window !== "undefined" ? window.location.origin + "/" : "";
    return [
      `Made Of · Daily link #${puzzle.number}`,
      `${cap(puzzle.start.name)} → ${cap(puzzle.goal.name)}`,
      `${moves} moves (par ${puzzle.par})`,
      squaresPlain + hintSuffix,
      url,
    ]
      .filter(Boolean)
      .join("\n");
  }, [
    game.deltas,
    game.hintCodes.length,
    moves,
    puzzle.goal.name,
    puzzle.number,
    puzzle.par,
    puzzle.start.name,
  ]);

  return (
    <>
      <section className="pbar" aria-live="polite">
        <button
          type="button"
          className="pmeta pmetaBtn"
          onClick={() => setModeOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={modeOpen}
          aria-label={
            isFree ? "Mode: Free play. Change mode" : `Mode: Daily link #${puzzle.number}. Change mode`
          }
        >
          <span>{isFree ? "Free play" : `Daily link #${puzzle.number}`}</span>
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
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
          <HelpButton onClick={() => setHelpOpen(true)} />
          <p className="msg">
            {hintMsg ||
              (game.done
                ? ""
                : `Move one link at a time, upstream or downstream, until you reach ${puzzle.goal.name}. Busy hubs like water and steel, and the elements, are closed.`)}
          </p>
        </div>
      </section>

      <nav className="trail" aria-label="Your path">
        {game.path.map((step, i) => (
          <span
            key={`${step.code}-${i}`}
            className={i === game.path.length - 1 ? "now" : ""}
          >
            {i > 0 ? <span aria-hidden="true">› </span> : null}
            {cap(step.name)}
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
            closedCodes: closedFromServer,
            lastHintCode: game.lastHintCode,
          }}
          onChipClick={onChipClick}
        />
      </div>

      {game.done && !game.gaveUp && (
        <section className="panel" aria-live="polite">
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
          <p className="msg">
            Green means a move took you closer, yellow kept you level, red
            took you further away.
          </p>
          <pre className="share">{shareText}</pre>
          <div className="row">
            <button
              className="btn primary"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareText);
                  setCopyMsg("Copied.");
                } catch {
                  setCopyMsg("Select the text above and copy it.");
                }
              }}
            >
              Copy result
            </button>
            <span className="msg" role="status">{copyMsg}</span>
          </div>
          <p className="msg nudge">
            Like Made Of?{" "}
            <Link href="/pricing">See what&rsquo;s free and what&rsquo;s coming</Link>.
          </p>
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
                key={`${s.code}-${i}`}
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

      <HowToPlay
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        gameLabel={`Daily link #${puzzle.number}`}
        title={
          <>
            Get from <b>{cap(puzzle.start.name)}</b> to{" "}
            <b>{puzzle.goal.name}</b> in {puzzle.par} moves.
          </>
        }
        steps={[
          {
            glyph: <GlyphCard />,
            title: "You're on the coloured card",
            body: "The pictogram in the middle is where you are. Everything around it is one link away.",
          },
          {
            glyph: <GlyphBowtie />,
            title: "Tap a chip to move",
            body: "The left side is what the current thing comes from. The right side is what it goes into.",
          },
          {
            glyph: <GlyphSquares />,
            title: "Watch the squares",
            body: "A green square means that move got you closer, yellow is level, red is further away.",
          },
          {
            glyph: <GlyphLock />,
            title: "Some things are closed",
            body: "Busy hubs like water and steel, and the elements, are closed in puzzles so you have to find a real route.",
          },
          {
            glyph: <GlyphHint />,
            title: "Stuck? Take a free hint",
            body: "Hints point at a neighbour that gets you closer. You can also undo your last move, or ask to see one shortest way.",
          },
        ]}
        footnote={`Par is ${puzzle.par} moves. Hints are free, but they show up on your result card.`}
      />
      <LinkModeDialog
        open={modeOpen}
        current={isFree ? "free" : "daily"}
        onDismiss={() => setModeOpen(false)}
        onPickFreshFreePlay={isFree && onNewFreePlay ? onNewFreePlay : undefined}
      />
    </>
  );
}

function GlyphCard() {
  return (
    <span className="mt lg N anim-pulse" aria-hidden="true">
      <span className="d" />
    </span>
  );
}

function GlyphBowtie() {
  return (
    <span className="mb" aria-hidden="true">
      <span className="mt md F">
        <span className="d" />
      </span>
      <span className="lk" />
      <span className="mt lg N anim-pulse">
        <span className="d" />
      </span>
      <span className="lk" />
      <span className="mt md M anim-nudge">
        <span className="d" />
      </span>
    </span>
  );
}

function GlyphSquares() {
  return (
    <span className="ms" aria-hidden="true">
      <i className="sq g anim-rise" style={{ animationDelay: "0s" }} />
      <i className="sq y anim-rise" style={{ animationDelay: ".3s" }} />
      <i className="sq r anim-rise" style={{ animationDelay: ".6s" }} />
    </span>
  );
}

function GlyphLock() {
  return (
    <span className="mt lg C anim-shimmer" style={{ opacity: 0.55 }} aria-hidden="true">
      <span className="mlk" />
    </span>
  );
}

function GlyphHint() {
  return (
    <span className="ml anim-glow" aria-hidden="true">
      <b />
      <i />
    </span>
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
