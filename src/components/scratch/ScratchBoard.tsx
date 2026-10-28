"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import { TIER, KIND, cap, tierColor } from "@/lib/taxonomy";
import { TargetPicker } from "./TargetPicker";
import type {
  ScratchItemFull,
  ScratchMakeResponse,
  ScratchPickerResult,
  ScratchStateResponse,
  SortMode,
} from "./types";
import { PENALTY } from "./types";

interface GameState {
  targetCode: string;
  targetName: string;
  haveCodes: string[]; // excludes "big-bang" (server adds it)
  steps: number;
  hints: number;
  badHides: number;
  detours: number;
  hidden: string[]; // codes of items the player has hidden
  startedAt: number | null; // ms since epoch of first make
  acc: number; // accumulated time including pauses
  paused: boolean;
  resumeAt: number | null;
  won: boolean;
  stars: number;
  blind: boolean;
}

const STORAGE_KEY = "madeof:scratch:v1";

function freshState(target: {
  code: string;
  name: string;
  blind: boolean;
}): GameState {
  return {
    targetCode: target.code,
    targetName: target.name,
    haveCodes: [],
    steps: 0,
    hints: 0,
    badHides: 0,
    detours: 0,
    hidden: [],
    startedAt: null,
    acc: 0,
    paused: false,
    resumeAt: null,
    won: false,
    stars: 0,
    blind: target.blind,
  };
}

function starsFor(steps: number, par: number, hints: number): number {
  const extra = steps - par;
  const s =
    extra <= Math.max(1, Math.round(par * 0.1))
      ? 3
      : extra <= Math.round(par * 0.35)
        ? 2
        : 1;
  return hints > 0 ? Math.min(s, 2) : s;
}

function fmtTime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The From Scratch board. Server-authoritative: every make is validated by
 * /api/scratch/make, every turn's "ready list" comes from /api/scratch/state.
 *
 * Scoring, pause/timer, star rating, floating feedback, pop-up messages, and
 * localStorage persistence all live here. The build-tree win visualisation
 * is deferred.
 */
export function ScratchBoard({
  initial,
}: {
  initial: ScratchStateResponse;
}) {
  const [game, setGame] = useState<GameState>(() =>
    freshState({
      code: initial.target.code,
      name: initial.target.name,
      blind: false,
    }),
  );
  const [state, setState] = useState<ScratchStateResponse>(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("tier");
  const [notice, setNotice] = useState<string>("");
  const [pop, setPop] = useState<{
    kind: "good" | "bad" | "win";
    item: ScratchItemFull;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowTick, setNowTick] = useState(0);

  // Hydrate from localStorage on first render.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<GameState> | null;
      if (!saved || typeof saved.targetCode !== "string") return;
      setGame((g) => ({ ...g, ...saved } as GameState));
      // Re-sync server state against saved have set.
      void loadServerState({
        targetCode: saved.targetCode!,
        haveCodes: saved.haveCodes ?? [],
      });
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also pull sort mode from storage.
  useEffect(() => {
    try {
      const s = localStorage.getItem("madeof:sort");
      if (s === "az" || s === "tier") setSortMode(s);
    } catch {
      /* ignore */
    }
  }, []);

  // Persist game state.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
    } catch {
      /* ignore */
    }
  }, [game]);

  // Timer tick for the elapsed-time display while playing.
  useEffect(() => {
    if (game.paused || game.won || !game.startedAt) return;
    const id = setInterval(() => setNowTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [game.paused, game.won, game.startedAt]);

  const elapsed = useMemo(() => {
    if (!game.startedAt) return 0;
    if (game.paused || game.won) return game.acc;
    const now = Date.now();
    void nowTick;
    return game.acc + (now - (game.resumeAt ?? game.startedAt));
  }, [game, nowTick]);

  // Reload server state when game.haveCodes / targetCode changes.
  useEffect(() => {
    void loadServerState({
      targetCode: game.targetCode,
      haveCodes: game.haveCodes,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.haveCodes, game.targetCode]);

  const loadServerState = useCallback(
    async (opts: { targetCode: string; haveCodes: string[] }) => {
      const res = await fetch("/api/scratch/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!res.ok) return;
      const body = (await res.json()) as ScratchStateResponse;
      setState(body);
    },
    [],
  );

  const points = useMemo(() => {
    const extra = Math.max(0, state.par ? game.steps - state.par : 0);
    return (
      1000 -
      game.hints * PENALTY.hint -
      game.badHides * PENALTY.hide -
      extra * PENALTY.detour
    );
  }, [game.hints, game.badHides, game.steps, state.par]);

  const onMake = useCallback(
    async (item: ScratchItemFull) => {
      if (busy || game.won) return;
      setBusy(true);
      setNotice("");
      try {
        const res = await fetch("/api/scratch/make", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            haveCodes: game.haveCodes,
            makeCode: item.code,
            targetCode: game.targetCode,
          }),
        });
        const body = (await res.json()) as ScratchMakeResponse;
        if (!body.ok || !body.item) {
          setNotice("That isn't ready yet.");
          return;
        }

        const now = Date.now();
        const started = game.startedAt ?? now;
        const resumeAt = game.startedAt ? game.resumeAt : now;

        setGame((g) => ({
          ...g,
          haveCodes: [...g.haveCodes, body.item!.code],
          steps: g.steps + 1,
          startedAt: started,
          resumeAt,
          won: Boolean(body.won),
          stars: body.won
            ? starsFor(g.steps + 1, state.par, g.hints)
            : g.stars,
          acc: body.won
            ? g.acc + (now - (resumeAt ?? started))
            : g.acc,
        }));

        setPop({
          kind: body.won ? "win" : "good",
          item: body.item,
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, game.haveCodes, game.startedAt, game.resumeAt, game.targetCode, game.won, state.par],
  );

  const onHint = useCallback(async () => {
    if (busy || game.won) return;
    try {
      const res = await fetch("/api/scratch/hint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          haveCodes: game.haveCodes,
          targetCode: game.targetCode,
        }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        hint: { code: string; slug: string; name: string } | null;
      };
      if (!body.hint) {
        setNotice("No hint available.");
        return;
      }
      setGame((g) => ({ ...g, hints: g.hints + 1 }));
      setNotice(`Try making ${body.hint.name}.`);
    } catch {
      /* ignore */
    }
  }, [busy, game.haveCodes, game.targetCode, game.won]);

  const onPause = useCallback(() => {
    setGame((g) => {
      if (!g.startedAt || g.won) return g;
      if (!g.paused) {
        const now = Date.now();
        return {
          ...g,
          paused: true,
          acc: g.acc + (now - (g.resumeAt ?? g.startedAt)),
          resumeAt: null,
        };
      }
      return { ...g, paused: false, resumeAt: Date.now() };
    });
  }, []);

  const onReset = useCallback(() => {
    setGame(
      freshState({
        code: game.targetCode,
        name: game.targetName,
        blind: game.blind,
      }),
    );
    setNotice("");
    setPop(null);
  }, [game.targetCode, game.targetName, game.blind]);

  const onNewTarget = useCallback(
    (pick: ScratchPickerResult) => {
      setGame(
        freshState({
          code: pick.code,
          name: pick.name,
          blind: false,
        }),
      );
      setNotice("");
      setPop(null);
    },
    [],
  );

  const onSort = useCallback((mode: SortMode) => {
    setSortMode(mode);
    try {
      localStorage.setItem("madeof:sort", mode);
    } catch {
      /* ignore */
    }
  }, []);

  // Group ready items by tier for the display.
  const groupedReady = useMemo(() => {
    const buckets = new Map<string, ScratchItemFull[]>();
    for (const r of state.ready) {
      const arr = buckets.get(r.tier) ?? [];
      arr.push(r);
      buckets.set(r.tier, arr);
    }
    const tierOrder = ["F", "N", "M", "C", "P", "S"];
    const out: Array<[string, ScratchItemFull[]]> = [];
    for (const t of tierOrder) {
      const b = buckets.get(t);
      if (b) {
        b.sort((a, b) =>
          sortMode === "az"
            ? a.name.localeCompare(b.name)
            : a.name.localeCompare(b.name),
        );
        out.push([t, b]);
      }
    }
    return out;
  }, [state.ready, sortMode]);

  const allSortedAZ = useMemo(() => {
    return [...state.ready].sort((a, b) => a.name.localeCompare(b.name));
  }, [state.ready]);

  // Hide pop after a while.
  useEffect(() => {
    if (!pop) return;
    const t = setTimeout(() => setPop(null), pop.kind === "win" ? 2400 : 1800);
    return () => clearTimeout(t);
  }, [pop]);

  return (
    <>
      <section className="sbar">
        <div className="goal">
          <span>Make a</span>
          <button
            type="button"
            className="tpick"
            onClick={() => setPickerOpen(true)}
          >
            <Pictogram
              name={state.target.name}
              tier={state.target.tier}
              kind={state.target.kind}
              symbol={state.target.symbol}
            />
            <span className="nm">{state.target.name}</span>
            <svg
              className="chev"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M3 5l4 4 4-4" />
            </svg>
          </button>
          <span>from the big bang</span>
        </div>
        <div className="counts">
          <span>
            <b>{fmtTime(elapsed)}</b>time
          </span>
          <span>
            <b>{points}</b>points
          </span>
          <span>
            <b>{state.ready.length + game.haveCodes.length + 1}</b>made
          </span>
          <span>
            <b>{state.missing}</b>to go
          </span>
        </div>
        <div className="row" style={{ flexBasis: "100%" }}>
          <button
            className="btn"
            type="button"
            onClick={onPause}
            disabled={!game.startedAt || game.won}
          >
            {game.paused ? "Resume" : "Pause"}
          </button>
          <button
            className="btn"
            type="button"
            onClick={onHint}
            disabled={game.paused || game.won}
          >
            Hint (−{PENALTY.hint})
          </button>
          <button className="btn" type="button" onClick={onReset}>
            Start over
          </button>
          <p className="msg">{notice}</p>
        </div>
      </section>

      {game.won && (
        <section className="panel win">
          <h3>You made {state.target.name} from the big bang.</h3>
          <div className="bigstars" aria-label={`${game.stars} of 3 stars`}>
            {[1, 2, 3].map((i) => (
              <span key={i} className={i <= game.stars ? "on" : ""}>
                ★
              </span>
            ))}
          </div>
          <div className="pstats">
            <span>
              <b>{fmtTime(game.acc)}</b>time
            </span>
            <span>
              <b>{points}</b>points
            </span>
            <span>
              <b>{game.steps}</b>steps (fewest about {state.par})
            </span>
          </div>
          <div className="row">
            <button className="btn primary" type="button" onClick={onReset}>
              Play again
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setPickerOpen(true)}
            >
              New target
            </button>
          </div>
        </section>
      )}

      {game.paused && !game.won && (
        <section
          className="panel"
          style={{ alignItems: "flex-start", paddingBlock: 40 }}
        >
          <h3>Paused</h3>
          <p className="sub" style={{ margin: 0 }}>
            The clock is stopped and your board is hidden until you come back.
          </p>
          <button className="btn primary" type="button" onClick={onPause}>
            Resume
          </button>
        </section>
      )}

      {!game.paused && (
        <div className="sgrid">
          {/* Target card */}
          <article
            className="tcard"
            style={{ "--c": tierColor(state.target.tier) } as React.CSSProperties}
          >
            <div className="tierline">
              <span className="pills">
                <span
                  className="pill t"
                  style={{ "--c": tierColor(state.target.tier) } as React.CSSProperties}
                >
                  {TIER[state.target.tier].name}
                </span>
                <span className="pill">{KIND[state.target.kind]}</span>
              </span>
            </div>
            <div className="fhead">
              <Pictogram
                name={state.target.name}
                tier={state.target.tier}
                kind={state.target.kind}
                symbol={state.target.symbol}
              />
              <h2>{state.target.name}</h2>
            </div>
            <p className="msg">
              Fewest steps from the start: about {state.par}.
            </p>
            {state.targetRecipes.map((r, i) => (
              <div
                key={r.id}
                className={`rcp${i === state.bestRecipeIndex ? " best" : ""}`}
              >
                <span className="rn">
                  {state.targetRecipes.length > 1
                    ? r.label ?? `Way ${i + 1}`
                    : "Recipe"}
                </span>
                <ul>
                  {r.requires.map((req) => (
                    <li key={req.slug} className={req.have ? "" : "miss"}>
                      <span className={req.have ? "ok" : "no"}>
                        {req.have ? "✓" : "○"}
                      </span>
                      <Pictogram
                        name={req.name}
                        tier={req.tier}
                        kind={req.kind}
                        symbol={req.symbol}
                      />
                      {req.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </article>

          {/* Ready list */}
          <section className="panel">
            <div className="phead">
              <h3>Ready to make</h3>
              <div className="seg" role="group" aria-label="Sort">
                <button
                  type="button"
                  className={sortMode === "tier" ? "on" : ""}
                  onClick={() => onSort("tier")}
                >
                  By tier
                </button>
                <button
                  type="button"
                  className={sortMode === "az" ? "on" : ""}
                  onClick={() => onSort("az")}
                >
                  A–Z
                </button>
              </div>
            </div>
            <p className="sub">Click something to make it.</p>
            {state.ready.length === 0 ? (
              <p className="msg">Nothing left to make.</p>
            ) : sortMode === "az" ? (
              <div
                className="group"
                style={{ alignItems: "flex-start" }}
              >
                <div className="glabel">
                  Everything you can make · {allSortedAZ.length}
                </div>
                <div className="cs">
                  {allSortedAZ.map((r) => (
                    <ReadyChip key={r.code} item={r} onPick={onMake} />
                  ))}
                </div>
              </div>
            ) : (
              groupedReady.map(([tier, items]) => (
                <div
                  key={tier}
                  className="group"
                  style={
                    {
                      alignItems: "flex-start",
                      "--c": tierColor(tier as Parameters<typeof tierColor>[0]),
                    } as React.CSSProperties
                  }
                >
                  <div
                    className="glabel"
                    style={{ color: tierColor(tier as Parameters<typeof tierColor>[0]) }}
                  >
                    {TIER[tier as keyof typeof TIER].name} · {items.length}
                  </div>
                  <div className="cs">
                    {items.map((r) => (
                      <ReadyChip key={r.code} item={r} onPick={onMake} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>

          {/* Inventory */}
          <section className="panel">
            <h3>Your stuff · {game.haveCodes.length + 1}</h3>
            <div className="cs">
              <span className="chip sm">
                <Pictogram
                  name="big bang"
                  tier="F"
                  kind="cosmic"
                  symbol={null}
                />
                <span className="nm">big bang</span>
              </span>
              {/* We don't carry per-item tier/kind in haveCodes alone; the
                 server could echo full items, but for phase-3 we show just
                 the big bang + a count. */}
            </div>
            {game.haveCodes.length > 0 && (
              <p className="sub" style={{ marginTop: 4 }}>
                And {game.haveCodes.length} other{" "}
                {game.haveCodes.length === 1 ? "thing" : "things"} you&rsquo;ve
                made.
              </p>
            )}
          </section>
        </div>
      )}

      {/* Pop-up feedback */}
      {pop && (
        <div className={`pop show ${pop.kind}`}>
          <Pictogram
            name={pop.item.name}
            tier={pop.item.tier}
            kind={pop.item.kind}
            symbol={pop.item.symbol}
          />
          <div className="pt">{cap(pop.item.name)}</div>
          {pop.item.fact ? (
            <div className="ps">
              {pop.item.fact.split(/(?<=\.)\s/)[0]}
            </div>
          ) : null}
        </div>
      )}

      <TargetPicker
        open={pickerOpen}
        onPick={onNewTarget}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

function ReadyChip({
  item,
  onPick,
}: {
  item: ScratchItemFull;
  onPick: (item: ScratchItemFull) => void;
}) {
  return (
    <button
      type="button"
      className="chip sm"
      onClick={() => onPick(item)}
      style={{ "--c": tierColor(item.tier) } as React.CSSProperties}
    >
      <Pictogram
        name={item.name}
        tier={item.tier}
        kind={item.kind}
        symbol={item.symbol}
      />
      <span className="nm">{item.name}</span>
    </button>
  );
}
