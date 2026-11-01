"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import { ageSets, catalogue } from "@/combine/data";
import { newGame, reduce } from "@/combine/engine";
import type { Action, Event, GameState } from "@/combine/engine";
import { matchAt, matchOn } from "@/combine/match";
import { ensureContext, suspend as suspendAudio, hasContext } from "@/combine/audio/core";
import { startMusic, stopMusic } from "@/combine/audio/music";
import { fx as playFx } from "@/combine/audio/sfx";
import { todayKey, dailySeed, freshEndlessSeed } from "@/combine/rng";
import { hydrateBundle, type SerialisedBundle } from "@/combine/serialise";
import {
  hydrateGame,
  loadBest,
  loadDailyDone,
  loadGame,
  loadSound,
  markFound,
  saveBest,
  saveDailyDone,
  saveGame,
  saveSound,
  type DailyResult,
  type MusicTrack,
} from "@/combine/storage";
import { dailyShareText, endlessShareText, shareText } from "@/combine/share";
import type {
  CombineItem,
  CombineRecipe,
  ThemeBundle,
  ThemeKey,
} from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { HowToPlay } from "@/components/common/HowToPlay";

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
  /** Pre-consume tile ids keyed by cell, rendered as overlays during the
   *  fuse pulse so the player sees the ingredients glow and shrink into
   *  the result. The engine has already nulled these cells in state. */
  fuseGhosts?: Map<number, string>;
  pop?: number;
  burst?: { at: number; pts: number; mult: number };
  /** Ghost output tile shown at `pop` while the result pops into place —
   *  only needed when the engine has already cleared the cell (e.g. a
   *  terminal result that shipped straight off the board). */
  popGhost?: string;
  shipped?: { at: number; bonus: number; out: string };
  crumble?: Set<number>;
  /** Chain multiplier for the top-row ×N badge. */
  chain?: number;
  /** Close-call bonus for the "Close call!" badge. */
  close?: number;
}

interface Props {
  bundles: {
    everyday: SerialisedBundle;
    everything: SerialisedBundle;
  };
}

/** The top-level client component that owns engine state. */
export function CombineBoard({ bundles: serialised }: Props) {
  const bundles = useMemo<Record<ThemeKey, ThemeBundle>>(
    () => ({
      everyday: hydrateBundle(serialised.everyday),
      everything: hydrateBundle(serialised.everything),
    }),
    [serialised],
  );
  // The initial render must be deterministic across SSR and the first
  // client paint — read nothing that depends on window/localStorage here.
  // A deterministic Everyday 6×6 seed=42 game is used as the hydration
  // target; after mount we may replace it with a saved game or kick off
  // a daily, both of which happen in an effect below.
  const initial = useMemo(
    () => newGame("everyday", bundles.everyday, { seed: 42, size: 6 }).state,
    [bundles.everyday],
  );

  const [state, setState] = useState<GameState>(initial);
  const bundle = bundles[state.theme];
  // Per-theme best scores + today's daily result. Loaded in an effect so
  // SSR/hydration stay deterministic.
  const [best, setBest] = useState<Record<ThemeKey, number>>({
    everyday: 0,
    everything: 0,
  });
  const [dailyDone, setDailyDone] = useState<DailyResult | null>(null);

  // On mount: load best scores + today's daily result, and resume the
  // endless save if any (daily resume lives on the user's explicit tap
  // of the Daily button in ThemeMenu).
  const didResume = useRef(false);
  useEffect(() => {
    if (didResume.current) return;
    didResume.current = true;
    setBest({
      everyday: loadBest("everyday"),
      everything: loadBest("everything"),
    });
    setDailyDone(loadDailyDone(todayKey()));
    // Try to resume either theme's endless save (we only have the single
    // ENDLESS slot, so whichever theme's save is there takes precedence).
    const everydaySave = loadGame(bundles.everyday, { daily: null });
    if (everydaySave) {
      setState(hydrateGame(everydaySave));
      return;
    }
    const everythingSave = loadGame(bundles.everything, { daily: null });
    if (everythingSave) {
      setState(hydrateGame(everythingSave));
    }
  }, [bundles.everyday, bundles.everything]);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [helpersOpen, setHelpersOpen] = useState(false);
  // Clear-mode: next tap on a full cell removes that tile.
  const [clearMode, setClearMode] = useState(false);
  // Move-mode: null = inactive. {from:null} = pick a tile. {from:cell} = pick
  // the destination.
  const [moveMode, setMoveMode] = useState<{ from: number | null } | null>(
    null,
  );
  // Hint toast — a card with a recipe to try when nothing fits.
  const [hintToast, setHintToast] = useState<{
    out: string;
    recipe: string[];
  } | null>(null);
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
  // Sound settings. Loaded on mount from localStorage, then applied to the
  // live audio graph. SoundMenu dispatches updates up to the parent so the
  // audio context sees them without needing a bus.
  const [sound, setSound] = useState<{
    music: MusicTrack;
    sfx: boolean;
    vol: number;
  }>({ music: "off", sfx: false, vol: 80 });
  useEffect(() => {
    setSound(loadSound());
  }, []);

  // Apply sound settings to the live audio graph if it exists. Music starts
  // only after the first user gesture (browsers block earlier starts); the
  // pointerdown listener below handles that first-run case.
  useEffect(() => {
    if (!hasContext()) return;
    ensureContext({ ...sound, vol: sound.vol / 100 });
    if (sound.music === "off") stopMusic();
    else startMusic({ busyGetter: () => state.age });
  }, [sound, state.age]);

  // First pointerdown: create the audio context and start music if the
  // user has chosen a track. We attach a one-shot listener to the document.
  useEffect(() => {
    const onDown = () => {
      ensureContext({ ...sound, vol: sound.vol / 100 });
      if (sound.music !== "off") {
        startMusic({ busyGetter: () => state.age });
      }
    };
    document.addEventListener("pointerdown", onDown, {
      passive: true,
      once: true,
    });
    return () => document.removeEventListener("pointerdown", onDown);
    // We intentionally use the latest `sound` and `state.age` captured on
    // mount; the effect above handles later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause music when the tab is hidden.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        stopMusic();
        const core = hasContext() ? ensureContext({ ...sound, vol: sound.vol / 100 }) : null;
        if (core) suspendAudio(core);
      } else if (sound.music !== "off" && hasContext()) {
        startMusic({ busyGetter: () => state.age });
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [sound, state.age]);
  const [bookOpen, setBookOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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
      // Combine events animate in two phases per step: a fuse pulse on the
      // ingredient cells (300ms), then a pop/burst on the output cell
      // (420ms). Chain steps queue after each other, so we build a timeline
      // of fx patches and schedule them with setTimeout.
      let latestDiscovery: { out: string; recipe: string[] } | null = null;
      let latestAgeUp: { age: number; sample: string[] } | null = null;

      // Immediate (non-combine) patch — placed/nope/crumble/discovery/age-up.
      const immediate: Fx = {};
      // Timeline of combine phases, each scheduled relative to time 0.
      const schedule: Array<{ at: number; patch: Fx; clearAt: number; clearKeys: (keyof Fx)[] }> = [];
      let cursor = 0;
      const FUSE_MS = 300;
      const POP_MS = 420;

      for (const e of events) {
        if (e.type === "placed") {
          immediate.placed = e.at;
          playFx("place");
          vibrate(6);
        } else if (e.type === "nope") {
          immediate.nope = e.at;
          playFx("nope");
          vibrate([8, 40, 8]);
        } else if (e.type === "combine") {
          const ghosts = new Map<number, string>();
          for (let k = 0; k < e.cells.length; k++) {
            ghosts.set(e.cells[k], e.inputs[k] ?? "");
          }
          // Phase 1: fuse pulse on ingredient cells (with ghost tiles so the
          // player sees them glow while the engine has already consumed them).
          const fusePatch: Fx = {
            fuse: new Set(e.cells),
            fuseGhosts: ghosts,
          };
          if (e.mult > 1) fusePatch.chain = e.mult;
          const fuseAt = cursor;
          schedule.push({
            at: fuseAt,
            patch: fusePatch,
            clearAt: fuseAt + FUSE_MS,
            clearKeys: ["fuse", "fuseGhosts"],
          });
          // Audio + haptic at the fuse strike.
          const sfxDelay = fuseAt;
          const scheduleAudio = (fn: () => void) => {
            if (sfxDelay <= 0) fn();
            else {
              const id = window.setTimeout(fn, sfxDelay);
              timers.current.push(id);
            }
          };
          scheduleAudio(() => {
            playFx("fuse", e.mult);
            vibrate(e.mult > 1 ? [15, 30, 25] : 14);
          });

          // Phase 2: pop + burst on the output cell. If this combine's result
          // was immediately shipped (terminal, consumed in the same reduce),
          // the engine has nulled the cell — pass popGhost so the UI still
          // has something to pop before the ship animation starts.
          const popAt = fuseAt + FUSE_MS;
          const nextIsShip = events.indexOf(e) + 1 < events.length &&
            events[events.indexOf(e) + 1].type === "shipped" &&
            (events[events.indexOf(e) + 1] as { at: number }).at === e.at;
          const popPatch: Fx = {
            pop: e.at,
            burst: { at: e.at, pts: e.pts, mult: e.mult },
          };
          if (nextIsShip) popPatch.popGhost = e.out;
          if (e.close) popPatch.close = e.close;
          if (e.close) {
            const id = window.setTimeout(() => {
              playFx("discover");
              vibrate([10, 30, 10, 30, 40]);
            }, popAt);
            timers.current.push(id);
          }
          schedule.push({
            at: popAt,
            patch: popPatch,
            clearAt: popAt + POP_MS + 180,
            clearKeys: ["pop", "burst", "popGhost", "chain", "close"],
          });
          cursor = popAt + POP_MS;
        } else if (e.type === "shipped") {
          // The ship animation starts right after the pop finishes.
          const shipAt = cursor;
          schedule.push({
            at: shipAt,
            patch: { shipped: { at: e.at, bonus: e.bonus, out: e.out } },
            clearAt: shipAt + 480,
            clearKeys: ["shipped"],
          });
          const id = window.setTimeout(() => playFx("ship"), shipAt);
          timers.current.push(id);
          cursor = shipAt + 380;
        } else if (e.type === "crumble") {
          immediate.crumble = new Set(e.cells);
          playFx("crumble");
        } else if (e.type === "discovery") {
          latestDiscovery = { out: e.out, recipe: e.recipe };
          window.setTimeout(() => playFx("discover"), 250);
        } else if (e.type === "age-up") {
          latestAgeUp = { age: e.age, sample: e.sample };
          playFx("age");
          vibrate([15, 30, 15, 30, 30]);
        } else if (e.type === "over") {
          playFx("over");
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

      if (Object.keys(immediate).length) {
        setFx((cur) => ({ ...cur, ...immediate }));
        if (immediate.placed != null) scheduleClear({ placed: 0 }, 260);
        if (immediate.nope != null) scheduleClear({ nope: 0 }, 380);
        if (immediate.crumble) scheduleClear({ crumble: undefined }, 500);
      }

      for (const step of schedule) {
        const applyId = window.setTimeout(() => {
          setFx((cur) => ({ ...cur, ...step.patch }));
        }, step.at);
        timers.current.push(applyId);
        const clearId = window.setTimeout(() => {
          setFx((cur) => {
            const next: Fx = { ...cur };
            for (const k of step.clearKeys) delete next[k];
            return next;
          });
        }, step.clearAt);
        timers.current.push(clearId);
      }
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

      // If the game just ended, write best + daily done.
      if (r.state.over && !state.over) {
        const prevBest = best[r.state.theme] ?? 0;
        if (r.state.score > prevBest) {
          saveBest(r.state.theme, r.state.score);
          setBest((b) => ({ ...b, [r.state.theme]: r.state.score }));
          r.state.newBest = true;
        }
        if (r.state.daily) {
          const bestShelfId =
            [...r.state.shelf].sort((a, b) => {
              const ta = bundle.items.get(a)?.tier ?? "M";
              const tb = bundle.items.get(b)?.tier ?? "M";
              const tv: Record<string, number> = {
                F: 1,
                N: 1,
                M: 2,
                C: 3,
                P: 4,
                S: 5,
              };
              return (tv[tb] ?? 2) - (tv[ta] ?? 2);
            })[0] ?? null;
          const dr: DailyResult = {
            key: r.state.daily,
            score: r.state.score,
            age: r.state.age,
            ageName: bundle.theme.ages[r.state.age] ?? "",
            made: r.state.made,
            top: bestShelfId,
          };
          saveDailyDone(dr);
          setDailyDone(dr);
        }
      }
      // Markers for the device-wide found set (will migrate to the authed
      // catalogue once that ships).
      const found = r.events
        .filter((e): e is Extract<Event, { type: "discovery" }> => e.type === "discovery")
        .map((e) => e.out);
      if (found.length) markFound(found);
    },
    [state, bundle, applyEvents, best],
  );

  // Save after every settled state transition. Skip while a choice is open
  // or a drag is in flight so we don't persist half-moves.
  useEffect(() => {
    if (!didResume.current) return;
    if (state.choosing) return;
    saveGame(state);
  }, [state]);

  const resetTransient = useCallback(() => {
    setFx({});
    setDiscovery(null);
    setAgeToast(null);
    setInfoTile(null);
    setSelectedSlot(null);
  }, []);

  const switchTheme = useCallback(
    (which: ThemeKey) => {
      // If we're already playing this theme in endless, nothing to do.
      if (which === state.theme && !state.daily) return;
      // Save the current game before swapping; try to resume the chosen
      // theme's endless save, otherwise start fresh.
      saveGame(state);
      const nextBundle = bundles[which];
      const saved = loadGame(nextBundle, { daily: null });
      if (saved && saved.theme === which) {
        setState(hydrateGame(saved));
      } else {
        const size =
          typeof window !== "undefined" && window.innerWidth <= 600 ? 5 : 6;
        setState(
          newGame(which, nextBundle, {
            seed: freshEndlessSeed(),
            size,
          }).state,
        );
      }
      resetTransient();
    },
    [state, bundles, resetTransient],
  );

  const startDaily = useCallback(() => {
    const day = todayKey();
    // Resume today's daily save if any, otherwise start a fresh daily.
    const saved = loadGame(bundles.everyday, { daily: day });
    if (saved) {
      saveGame(state);
      setState(hydrateGame(saved));
    } else {
      saveGame(state);
      setState(
        newGame("everyday", bundles.everyday, {
          daily: day,
          size: 5,
          seed: dailySeed(day),
        }).state,
      );
    }
    resetTransient();
  }, [bundles, state, resetTransient]);

  const shareDaily = useCallback(async () => {
    const dr = dailyDone;
    if (!dr) return;
    // Rebuild a share text from the stored result.
    const text =
      `Made Of · Daily Combine ${dr.key}\n` +
      // One square per Everyday age, green up to the age reached.
      Array.from({ length: bundles.everyday.theme.ages.length }, (_, k) =>
        k <= dr.age ? "🟩" : "⬜",
      ).join("") +
      ` reached ${dr.ageName}\n` +
      `${dr.score.toLocaleString("en")} points · ${dr.made} made${
        dr.top ? ` · best: ${dr.top}` : ""
      }\n` +
      "https://madeof.app/combine";
    await shareText(text);
  }, [dailyDone, bundles.everyday]);

  const onCellTap = useCallback(
    (cell: number) => {
      // Clear mode: tap a full cell to remove it.
      if (clearMode) {
        if (state.board[cell] == null) return;
        act({ type: "clear", cell });
        setClearMode(false);
        return;
      }
      // Move mode: first tap picks the source, second tap drops it.
      if (moveMode) {
        if (moveMode.from == null) {
          if (state.board[cell] == null) return;
          setMoveMode({ from: cell });
          return;
        }
        if (moveMode.from === cell) {
          // Tap the picked tile again to cancel.
          setMoveMode({ from: null });
          return;
        }
        act({ type: "move", from: moveMode.from, to: cell });
        setMoveMode(null);
        return;
      }
      // No tray tile selected: tapping a full board tile opens its info
      // card (per spec: tap a board tile with nothing selected). Empty
      // cells with no selection do nothing.
      if (selectedSlot == null) {
        const target = state.board[cell];
        if (target != null) setInfoTile(target);
        return;
      }
      const target = state.board[cell];
      if (target == null) {
        act({ type: "place", slot: selectedSlot, cell });
      } else {
        act({ type: "drop-on", slot: selectedSlot, cell });
      }
    },
    [act, selectedSlot, state.board, clearMode, moveMode],
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
  // toast, age toast, hint toast, helpers menu, helper mode, selected tray
  // tile. Doesn't dismiss the choice picker (the engine is paused and
  // needs a decision).
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
      if (hintToast) {
        setHintToast(null);
        return;
      }
      if (themeOpen) {
        setThemeOpen(false);
        return;
      }
      if (bookOpen) {
        setBookOpen(false);
        return;
      }
      if (soundOpen) {
        setSoundOpen(false);
        return;
      }
      if (helpersOpen) {
        setHelpersOpen(false);
        return;
      }
      if (clearMode) {
        setClearMode(false);
        return;
      }
      if (moveMode) {
        setMoveMode(null);
        return;
      }
      if (selectedSlot != null) {
        setSelectedSlot(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    infoTile,
    discovery,
    ageToast,
    hintToast,
    themeOpen,
    bookOpen,
    soundOpen,
    helpersOpen,
    clearMode,
    moveMode,
    selectedSlot,
  ]);

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

  const findHint = useCallback(() => {
    // Teach a recipe from the current age that uses a tile we have in the
    // tray (preferring unfound outputs). Mirrors step 4 of cbFindHint. If
    // nothing in the tray is relevant, fall back to any recipe from this
    // age with an unfound output; else any recipe from this age.
    const A = ageSets(bundle, state.age);
    const trayHas = new Set(
      state.tray.filter((t): t is string => Boolean(t)),
    );
    const found = new Set(state.found);
    const scored = A.recipes
      .map((r) => {
        const touchesTray = r.all.some((x) => trayHas.has(x));
        const unfound = !found.has(r.out);
        return { r, score: (touchesTray ? 2 : 0) + (unfound ? 1 : 0) };
      })
      .sort((a, b) => b.score - a.score);
    const pick = scored[0]?.r;
    if (!pick) return null;
    return { out: pick.out, recipe: pick.all };
  }, [bundle, state.age, state.tray, state.found]);

  const onHelper = useCallback(
    (which: "hint" | "swap" | "clear" | "move") => {
      setHelpersOpen(false);
      // Entering move/clear cancels selection and any opposing mode.
      if (which === "clear") {
        if (state.clears <= 0 || state.over) return;
        setMoveMode(null);
        setSelectedSlot(null);
        setClearMode((m) => !m);
        return;
      }
      if (which === "move") {
        if (state.mv <= 0 || state.over) return;
        setClearMode(false);
        setSelectedSlot(null);
        setMoveMode((m) => (m ? null : { from: null }));
        return;
      }
      if (which === "swap") {
        if (state.swaps <= 0) return;
        setClearMode(false);
        setMoveMode(null);
        act({ type: "swap" });
        return;
      }
      if (which === "hint") {
        if (state.hints <= 0 || state.over) return;
        const h = findHint();
        if (!h) return;
        act({ type: "hint" });
        setHintToast(h);
        const id = window.setTimeout(() => setHintToast(null), 9000);
        timers.current.push(id);
      }
    },
    [act, state.clears, state.mv, state.swaps, state.hints, state.over, findHint],
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
          best={best[state.theme] ?? 0}
          helpersOpen={helpersOpen}
          clearMode={clearMode}
          moveMode={moveMode != null}
          onToggleHelpers={() => {
            // If a mode is active, the button is Cancel: exit the mode.
            if (clearMode) {
              setClearMode(false);
              return;
            }
            if (moveMode) {
              setMoveMode(null);
              return;
            }
            setHelpersOpen((o) => !o);
          }}
          onHelper={onHelper}
          onTheme={() => setThemeOpen(true)}
        />
        <TipLine
          state={state}
          selectedSlot={selectedSlot}
          preview={preview}
          clearMode={clearMode}
          moveMode={moveMode}
        />
        <AgeBar
          state={state}
          bundle={bundle}
          soundOn={sound.music !== "off" || sound.sfx}
          onBook={() => setBookOpen(true)}
          onSound={() => setSoundOpen(true)}
          onHelp={() => setHelpOpen(true)}
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
          clearMode={clearMode}
          moveMode={moveMode}
          onCellTap={onCellTap}
        />
        <Tray
          state={state}
          bundle={bundle}
          selected={selectedSlot}
          onSlotTap={onSlotTap}
          onSlotPointerDown={onSlotPointerDown}
        />
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
            best={best[state.theme] ?? 0}
            onPlayAgain={() => {
              // From a finished daily, "Play endless" starts a fresh
              // endless Everyday game. From endless, start another endless
              // in the same theme.
              const nextTheme = state.theme;
              const nextDaily = null;
              const size =
                typeof window !== "undefined" && window.innerWidth <= 600
                  ? 5
                  : 6;
              setState(
                newGame(nextTheme, bundles[nextTheme], {
                  daily: nextDaily,
                  seed: freshEndlessSeed(),
                  size,
                }).state,
              );
              resetTransient();
            }}
            onShare={async () => {
              const text = state.daily
                ? dailyShareText(state.daily, state, bundle)
                : endlessShareText(state, bundle);
              await shareText(text);
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
        {hintToast && (
          <HintToast
            hint={hintToast}
            bundle={bundle}
            onDismiss={() => setHintToast(null)}
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
            bundles={bundles}
            daily={state.daily}
            current={state.theme}
            dailyDone={dailyDone}
            onPickTheme={(which) => {
              setThemeOpen(false);
              switchTheme(which);
            }}
            onPickDaily={() => {
              setThemeOpen(false);
              startDaily();
            }}
            onShareDaily={() => {
              shareDaily();
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
          <SoundMenu
            value={sound}
            onChange={(next) => {
              setSound(next);
              saveSound(next);
              // Play a confirmation when SFX is toggled on, matching the
              // prototype's setSfx behaviour.
              if (next.sfx && !sound.sfx) playFx("place");
            }}
            onDismiss={() => setSoundOpen(false)}
          />
        )}
        <HowToPlay
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          gameLabel={`Combine · ${bundle.theme.name}`}
          title={<>Place things that touch. Watch the world combine.</>}
          steps={[
            {
              glyph: <GlyphDrag />,
              title: "Drop or tap-to-place",
              body: "Drag a tray tile onto the board, or tap it and then tap a square. Pieces on the board can also be moved.",
            },
            {
              glyph: <GlyphCombine />,
              title: "Touching things combine",
              body: "When neighbouring tiles make a recipe, they fuse and the result lands in their place. Everything used is spent.",
            },
            {
              glyph: <GlyphShelf />,
              title: "Finished things go to your shelf",
              body: "Big, lasting things get shipped and keep for the rest of the run. Tap the book to see your collection.",
            },
            {
              glyph: <GlyphGlow />,
              title: "Glow means you've found it",
              body: "A glowing square is a combo you've made before. New combos never glow — try things in new places.",
            },
            {
              glyph: <GlyphAges />,
              title: "Fill the bar to reach the next age",
              body: "Every combine fills the age bar. New ages unlock new recipes. Run out of moves and the game is over.",
            },
          ]}
          footnote="Need a nudge mid-run? Use the Helpers button for a hint, a swap, a clear or a move."
        />
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
  best,
  onPlayAgain,
  onShare,
}: {
  state: GameState;
  bundle: ThemeBundle;
  best: number;
  onPlayAgain: () => void;
  onShare: () => void;
}) {
  const ages = bundle.theme.ages;
  const ageName = ages[state.age];
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
          <button type="button" className="cbh" onClick={onShare}>
            Share
          </button>
          <button type="button" className="cbh" onClick={onPlayAgain}>
            {state.daily ? "Play endless" : "Play again"}
          </button>
        </div>
      </section>
    </>
  );
}

/* ---------- Theme menu ---------- */

function ThemeMenu({
  bundles,
  daily,
  current,
  dailyDone,
  onPickTheme,
  onPickDaily,
  onShareDaily,
  onDismiss,
}: {
  bundles: Record<ThemeKey, ThemeBundle>;
  daily: string | null;
  current: ThemeKey;
  dailyDone: DailyResult | null;
  onPickTheme: (which: ThemeKey) => void;
  onPickDaily: () => void;
  onShareDaily: () => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <div className="cbscrim" onClick={onDismiss} />
      <section
        className="cbover cbthemes"
        role="dialog"
        aria-label="Choose a theme"
      >
        <span className="k">Today</span>
        {dailyDone ? (
          <div className="cbtopt cbdaily done">
            <b>Daily game · done</b>
            <span>
              {dailyDone.score.toLocaleString("en")} points · reached{" "}
              {dailyDone.ageName}. A new one tomorrow.
            </span>
            <button
              type="button"
              className="cbh"
              onClick={onShareDaily}
              style={{ marginTop: 6, height: 36 }}
            >
              Share result
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`cbtopt cbdaily${daily ? " on" : ""}`}
            onClick={onPickDaily}
          >
            <b>Daily game{daily ? " · playing" : ""}</b>
            <span>
              Same start and same tiles for everyone today. One go. Everyday
              theme, 5×5.
            </span>
          </button>
        )}
        <span className="k">Endless</span>
        {(Object.keys(bundles) as ThemeKey[]).map((key) => {
          const b = bundles[key];
          return (
            <button
              key={key}
              type="button"
              className={`cbtopt${key === current && !daily ? " on" : ""}`}
              onClick={() => onPickTheme(key)}
            >
              <b>{b.theme.name}</b>
              <span>{b.theme.desc}</span>
              <em>{b.outputs.size} things to make</em>
            </button>
          );
        })}
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

function SoundMenu({
  value,
  onChange,
  onDismiss,
}: {
  value: { music: MusicTrack; sfx: boolean; vol: number };
  onChange: (next: { music: MusicTrack; sfx: boolean; vol: number }) => void;
  onDismiss: () => void;
}) {
  const tracks: Array<[MusicTrack, string, string]> = [
    ["drift", "Drift", "Slow pads, low stimulation"],
    ["piano", "Calm piano", "Slow, soft and roomy"],
    ["chimes", "Chimes", "Gentle and a bit busier"],
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
            className={`cbtopt${value.music === k ? " on" : ""}`}
            onClick={() => onChange({ ...value, music: k })}
          >
            <b>{n}</b>
            {d && <span>{d}</span>}
          </button>
        ))}
        <span className="k">Sound</span>
        <button
          type="button"
          className={`cbtopt cbsw${value.sfx ? " on" : ""}`}
          role="switch"
          aria-checked={value.sfx}
          onClick={() => onChange({ ...value, sfx: !value.sfx })}
        >
          <b>Sound effects</b>
          <span>{value.sfx ? "On" : "Off"}</span>
        </button>
        <label className="cbvol">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={value.vol}
            onChange={(e) =>
              onChange({ ...value, vol: Number(e.currentTarget.value) })
            }
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
        <button type="button" className="cbh cbback" onClick={onDismiss}>
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

function HintToast({
  hint,
  bundle,
  onDismiss,
}: {
  hint: { out: string; recipe: string[] };
  bundle: ThemeBundle;
  onDismiss: () => void;
}) {
  const item = bundle.items.get(hint.out);
  if (!item) return null;
  return (
    <div className="cbdisc" role="status" onClick={onDismiss}>
      <Pictogram
        name={item.name}
        tier={item.tier}
        kind={item.kind}
        symbol={item.symbol}
      />
      <div>
        <span className="k">Hint · tap to close</span>
        <b>Nothing fits right now. Try this:</b>
        <div className="cbrcp">
          {hint.recipe.map((pid, k) => {
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
                {k < hint.recipe.length - 1 && <i>+</i>}
              </span>
            );
          })}
          <i>=</i>
          <span>{cap(item.name)}</span>
        </div>
        <p>Keep the pieces you have, and watch your tray for the rest.</p>
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
  best,
  helpersOpen,
  clearMode,
  moveMode,
  onToggleHelpers,
  onHelper,
  onTheme,
}: {
  state: GameState;
  fx: Fx;
  best: number;
  helpersOpen: boolean;
  clearMode: boolean;
  moveMode: boolean;
  onToggleHelpers: () => void;
  onHelper: (which: "hint" | "swap" | "clear" | "move") => void;
  onTheme: () => void;
}) {
  const helpersLeft = state.swaps + state.clears + state.hints + state.mv;
  const themeName = state.daily ? "Daily" : state.theme === "everyday" ? "Everyday" : "Everything";
  const bestDisplay = Math.max(best, state.over ? state.score : 0);
  const modeActive = clearMode || moveMode;
  return (
    <div className="cbtop">
      <div className="cbscore">
        <b>{state.score.toLocaleString("en")}</b>
        <span>best {bestDisplay.toLocaleString("en")}</span>
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
          className={`cbh${modeActive ? " on" : ""}${helpersOpen ? " open" : ""}`}
          id="cbHelp"
          type="button"
          aria-haspopup="menu"
          aria-expanded={helpersOpen}
          aria-label={modeActive ? "Cancel" : "Helpers"}
          onClick={onToggleHelpers}
          disabled={state.over || (!modeActive && helpersLeft === 0)}
        >
          {modeActive ? (
            <>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
              <span className="lbl">Cancel</span>
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 9h18v11H3zM8 9V5h8v4M3 13h18M11 12v3h2v-3" />
              </svg>
              <span className="lbl">Helpers</span>
              <b>{helpersLeft}</b>
            </>
          )}
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
              disabled={state.mv === 0}
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
              disabled={state.clears === 0}
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
  clearMode,
  moveMode,
}: {
  state: GameState;
  selectedSlot: number | null;
  preview: Map<number, Preview>;
  clearMode: boolean;
  moveMode: { from: number | null } | null;
}) {
  let tip: string;
  if (state.over) tip = "Game over.";
  else if (state.choosing) tip = "These make more than one thing. Pick one.";
  else if (clearMode) tip = "Tap a tile to clear it.";
  else if (moveMode) {
    if (moveMode.from == null) tip = "Tap the tile you want to move.";
    else {
      const name = state.board[moveMode.from];
      tip = `Now tap where the ${name ? cap(name).toLowerCase() : "tile"} should go. Moving isn't a turn.`;
    }
  } else if (selectedSlot != null) {
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
  soundOn,
  onBook,
  onSound,
  onHelp,
}: {
  state: GameState;
  bundle: ThemeBundle;
  soundOn: boolean;
  onBook: () => void;
  onSound: () => void;
  onHelp: () => void;
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
        className={`cbsnd${soundOn ? " on" : ""}`}
        aria-label="Music and sound settings"
        title="Music and sound"
        onClick={onSound}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9h4l5-4v14l-5-4H4z" />
          {soundOn ? (
            <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
          ) : (
            <path d="M17 9l5 6M22 9l-5 6" />
          )}
        </svg>
      </button>
      <button
        type="button"
        className="cbsnd"
        aria-label="How to play"
        title="How to play"
        onClick={onHelp}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.3 9.2a2.7 2.7 0 1 1 4.2 2.4c-1 .6-1.5 1.2-1.5 2.4" />
          <circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none" />
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
  clearMode,
  moveMode,
  onCellTap,
}: {
  state: GameState;
  bundle: ThemeBundle;
  fx: Fx;
  preview: Map<number, Preview>;
  dragOver: { cell: number | null; ok: boolean } | null;
  clearMode: boolean;
  moveMode: { from: number | null } | null;
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
        const isClearable = clearMode && v != null;
        const isMovable =
          moveMode != null && moveMode.from == null && v != null;
        const isMoving = moveMode != null && moveMode.from === i;
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
            clearable={isClearable}
            movable={isMovable}
            moving={isMoving}
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
  clearable,
  movable,
  moving,
  onTap,
}: {
  cell: number;
  id: string | null;
  bundle: ThemeBundle;
  crumbleTick: number;
  fx: Fx;
  preview: Preview | undefined;
  over: "ok" | "no" | null;
  clearable: boolean;
  movable: boolean;
  moving: boolean;
  onTap: () => void;
}) {
  // Visual-only overlays: the engine has already mutated state (consumed
  // ingredients, placed/removed outputs) by the time the UI applies fx, so
  // for the animation window we may need to render a tile the engine no
  // longer has. In priority order: fuseGhost (ingredient during pulse) →
  // popGhost (output that will ship this frame) → shipped (output flying
  // off) → actual state tile.
  const fuseGhostId = fx.fuseGhosts?.get(cell);
  const isPop = fx.pop === cell;
  const popGhostId = isPop ? fx.popGhost : undefined;
  const isShipped = fx.shipped?.at === cell;
  const shipGhostId = isShipped ? fx.shipped?.out : undefined;
  const displayId = fuseGhostId || popGhostId || id || shipGhostId || null;
  const empty = !displayId;
  const item = displayId ? bundle.items.get(displayId) : null;
  const ghostItem = preview?.out ? bundle.items.get(preview.out) : null;

  const inFuse = fx.fuse?.has(cell) ?? false;
  const inCrumble = fx.crumble?.has(cell) ?? false;
  const isPlaced = fx.placed === cell;
  const isNope = fx.nope === cell;
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
  // Helper modes.
  if (clearable) classes.push("clearable");
  if (movable) classes.push("movable");
  if (moving) classes.push("moving");

  const words = displayId ? displayId.split("-") : [];
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

/** navigator.vibrate wrapper that silently no-ops on unsupported devices. */
function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // ignore
  }
}

function fillVar(item: CombineItem): React.CSSProperties {
  // Pastel tier fill, with --pk left as the global ink colour — matches the
  // prototype's `icon()` which only sets --fill. Borders and drop shadows
  // on .cbc.full / .cbp are already keyed to --pk through the stylesheet.
  return { "--fill": `var(--f${item.tier})` } as React.CSSProperties;
}


function GlyphDrag() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <path d="M13 13l7 7M13 20h7v-7" />
    </svg>
  );
}

function GlyphCombine() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="7" width="7" height="10" rx="1" />
      <rect x="14" y="7" width="7" height="10" rx="1" />
      <path d="M10 12h4" />
    </svg>
  );
}

function GlyphShelf() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 18h18" />
      <rect x="5" y="9" width="4" height="9" />
      <rect x="11" y="6" width="4" height="12" />
      <rect x="17" y="11" width="2.8" height="7" />
    </svg>
  );
}

function GlyphGlow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4" />
    </svg>
  );
}

function GlyphAges() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="10" width="18" height="5" rx="1" />
      <path d="M3 12.5h12" />
      <path d="M18 7l3 3-3 3" />
    </svg>
  );
}
