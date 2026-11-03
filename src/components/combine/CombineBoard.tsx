"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { Pictogram } from "@/pictograms/Pictogram";
import { ageSets, catalogue, catalogueByKind } from "@/combine/data";
import { newGame, reduce } from "@/combine/engine";
import type { Action, Event, GameState } from "@/combine/engine";
import { matchAt, matchOn } from "@/combine/match";
import { ensureContext, suspend as suspendAudio, hasContext } from "@/combine/audio/core";
import { fadeOutMusic, startMusic } from "@/combine/audio/music";
import { fx as playFx } from "@/combine/audio/sfx";
import { todayKey, dailySeed, freshEndlessSeed } from "@/combine/rng";
import { hydrateBundle, type SerialisedBundle } from "@/combine/serialise";
import {
  hydrateGame,
  loadBest,
  loadSeenAges,
  saveSeenAges,
  loadDailyDone,
  loadGame,
  loadSound,
  saveBest,
  saveDailyDone,
  saveGame,
  saveSound,
  type DailyResult,
  type MusicTrack,
} from "@/combine/storage";
import { useCollection } from "@/combine/useCollection";
import {
  dailyShareQuery,
  dailyShareText,
  endlessShareText,
  resolveItemName,
  shareText,
} from "@/combine/share";
import type {
  CombineItem,
  CombineRecipe,
  ThemeBundle,
  ThemeKey,
} from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { HowToPlay } from "@/components/common/HowToPlay";

/** Hand-picked example chains shown in the Ages dialog, keyed by theme and
 *  then by 0-based age index. One canonical chain per age so the dialog is
 *  deterministic — rotating examples made players think the rules were
 *  changing. The last node is an item that lives in that band in the current
 *  KB; if the KB changes an id, the row is dropped and we re-pick here. */
const AGE_CHAINS: Partial<Record<ThemeKey, string[][]>> = {
  everything: [
    ["hydrogen", "star"],
    ["clay", "brick"],
    ["wheat", "flour", "bread"],
    ["crude oil", "plastic", "tyre"],
    ["copper", "copper wire", "light bulb"],
    ["cotton", "thread", "fabric", "shirt"],
  ],
};

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
  selected: { source: "tray" | "hold"; slot: number } | null,
  extraKnown: Iterable<string>,
): Map<number, Preview> {
  const out = new Map<number, Preview>();
  if (selected == null) return out;
  const src = selected.source === "hold" ? state.hold : state.tray;
  const x = src[selected.slot];
  if (x == null) return out;
  // "Known" = anything found this game or anywhere in the player's lifetime
  // collection. Signed-out players will see the latter as empty.
  const found = new Set(state.found);
  for (const id of extraKnown) found.add(id);
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
  /** Cell where a new discovery just formed — triggers a tier-colored
   *  sparkle pulse after the pop phase. */
  discover?: number;
  /** Chain visualisation. One trace per in-flight chain. The overlay
   *  reads this to draw arcs between each step's ingredients and output,
   *  and cells listed in `members` get a persistent tint for the chain's
   *  lifetime. `tier` keys the accent colour of the final output.
   *  Cleared ~900ms after the chain's last pop. */
  trace?: ChainTrace;
}

interface ChainStep {
  /** Ingredient cells for this step. */
  from: number[];
  /** Output cell. */
  to: number;
  /** Tier of the output tile — drives arc colour via --f<tier>. */
  tier: string;
  /** When (in trace-local ms) the arc should start drawing. */
  drawAt: number;
}

interface ChainTrace {
  steps: ChainStep[];
  /** All cells touched by the chain (ingredients + outputs). */
  members: Set<number>;
  /** Tier of the final output — used as the chain's dominant accent. */
  tier: string;
  /** Local time (ms) when the trace first mounts; the overlay uses
   *  `performance.now() - startedAt` to pick which steps have "drawn". */
  startedAt: number;
}

interface Props {
  bundles: {
    everything: SerialisedBundle;
  };
}

/** The top-level client component that owns engine state. */
export function CombineBoard({ bundles: serialised }: Props) {
  const bundles = useMemo<Record<ThemeKey, ThemeBundle>>(
    () => ({
      everything: hydrateBundle(serialised.everything),
    }),
    [serialised],
  );
  // The initial render must be deterministic across SSR and the first
  // client paint — read nothing that depends on window/localStorage here.
  // A deterministic 6×6 seed=42 game is used as the hydration target;
  // after mount we may replace it with a saved game or kick off a daily,
  // both of which happen in an effect below.
  const initial = useMemo(
    () => newGame("everything", bundles.everything, { seed: 42, size: 6 }).state,
    [bundles.everything],
  );

  const [state, setState] = useState<GameState>(initial);
  const bundle = bundles[state.theme];
  // Collection is partitioned by scope: endless (both endless themes share
  // one bucket) vs. daily (its own bucket so daily puzzles are a fair start,
  // not fed by endless grinding). See useCollection for the full contract.
  const collectionScope = state.daily ? "daily" : "endless";
  const {
    collection,
    authed: collectionAuthed,
    isPending: collectionPending,
    record: recordDiscoveries,
  } = useCollection(collectionScope);
  // Per-theme best scores + today's daily result. Loaded in an effect so
  // SSR/hydration stay deterministic.
  const [best, setBest] = useState<Record<ThemeKey, number>>({
    everything: 0,
  });
  const [dailyDone, setDailyDone] = useState<DailyResult | null>(null);
  // When a theme's numAges has grown since the player last saw it, surface
  // a one-time banner with the new age's label. Keyed by theme → label.
  const [newAgeBanner, setNewAgeBanner] = useState<Partial<Record<ThemeKey, string>>>({});

  // On mount: load best scores + today's daily result, and resume the
  // endless save if any (daily resume lives on the user's explicit tap
  // of the Daily button in ThemeMenu).
  const didResume = useRef(false);
  useEffect(() => {
    if (didResume.current) return;
    didResume.current = true;
    setBest({
      everything: loadBest("everything"),
    });
    setDailyDone(loadDailyDone(todayKey()));
    // Age-promotion banner: compare each theme's live numAges to what we
    // last showed on this device. On first ever visit (seen=0), skip —
    // the banner is for the moment *after* the player has already played
    // through N ages, not an unsolicited onboarding popup.
    const banners: Partial<Record<ThemeKey, string>> = {};
    for (const theme of Object.keys(bundles) as ThemeKey[]) {
      const b = bundles[theme];
      const curr = b.theme.ages.length;
      const seen = loadSeenAges(theme);
      if (seen > 0 && curr > seen) {
        banners[theme] = b.theme.ages[curr - 1] ?? String(curr);
      }
      // Prime seen on first visit so we don't banner later.
      if (seen === 0) saveSeenAges(theme, curr);
    }
    if (Object.keys(banners).length) setNewAgeBanner(banners);
    // Deep link: ?d=<dayKey> on /combine starts today's daily. Yesterday's
    // keys fall through to the regular endless resume (today's daily will
    // still be a tap away from the theme menu).
    const sp =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const deepLinkDay = sp?.get("d");
    if (deepLinkDay && deepLinkDay === todayKey()) {
      const day = deepLinkDay;
      const saved = loadGame(bundles.everything, { daily: day });
      setState(
        saved
          ? hydrateGame(saved)
          : newGame("everything", bundles.everything, {
              daily: day,
              size: 6,
              seed: dailySeed(day),
            }).state,
      );
      return;
    }
    const everythingSave = loadGame(bundles.everything, { daily: null });
    if (everythingSave) {
      setState(hydrateGame(everythingSave));
    }
  }, [bundles.everything]);
  const [selectedSlot, setSelectedSlot] = useState<{
    source: "tray" | "hold";
    slot: number;
  } | null>(null);
  const [helpersOpen, setHelpersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Clear-mode: next tap on a full cell removes that tile.
  const [clearMode, setClearMode] = useState(false);
  // Move-mode: null = inactive. {from:null} = pick a tile. {from:cell} = pick
  // the destination.
  const [moveMode, setMoveMode] = useState<{ from: number | null } | null>(
    null,
  );
  // Shore-mode: next tap on a crumbling tile resets its counter.
  const [shoreMode, setShoreMode] = useState(false);
  // Hint toast — a card with a recipe to try when nothing fits.
  const [hintToast, setHintToast] = useState<{
    out: string;
    recipe: string[];
  } | null>(null);
  const [fx, setFx] = useState<Fx>({});
  const [discovery, setDiscovery] = useState<{
    out: string;
    recipe: string[];
    firstLifetime: boolean;
  } | null>(null);
  const [ageToast, setAgeToast] = useState<{
    age: number;
    sample: string[];
  } | null>(null);
  // The tile pressed and currently being held / dragged. Mirrors the
  // prototype's cbDrag record. Ghost x/y are in viewport coords.
  const [drag, setDrag] = useState<{
    slot: number;
    source: "tray" | "hold";
    x: number;
    y: number;
    tileWidth: number;
    overCell: number | null;
    overOk: boolean;
    /** True while the pointer is over the hold zone. When set, `overCell`
     *  will be null — only one of the two is active at a time. */
    overHold: boolean;
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
    if (sound.music === "off") fadeOutMusic();
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

  // Pause music when the tab is hidden, and silence it before the page is
  // torn down. Both paths fade the music bus first so already-scheduled
  // oscillators don't get cut off mid-cycle (which clicks on close).
  useEffect(() => {
    let suspendTimer: number | null = null;
    const silence = () => {
      if (suspendTimer != null) {
        window.clearTimeout(suspendTimer);
        suspendTimer = null;
      }
      const fade = fadeOutMusic();
      const core = hasContext()
        ? ensureContext({ ...sound, vol: sound.vol / 100 })
        : null;
      if (!core) return;
      suspendTimer = window.setTimeout(() => {
        suspendAudio(core);
        suspendTimer = null;
      }, Math.ceil(fade * 1000) + 20);
    };
    const onVis = () => {
      if (document.hidden) {
        silence();
      } else if (sound.music !== "off" && hasContext()) {
        if (suspendTimer != null) {
          window.clearTimeout(suspendTimer);
          suspendTimer = null;
        }
        startMusic({ busyGetter: () => state.age });
      }
    };
    const onHide = () => silence();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      if (suspendTimer != null) window.clearTimeout(suspendTimer);
    };
  }, [sound, state.age]);
  const [bookOpen, setBookOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [agesOpen, setAgesOpen] = useState(false);
  // Game-over summary card. Opens automatically when the run ends; the
  // player can dismiss it to review the final board (especially useful for
  // a finished daily they re-entered from the theme menu).
  const [overCardOpen, setOverCardOpen] = useState(false);
  const prevOverRef = useRef(false);
  useEffect(() => {
    if (state.over && !prevOverRef.current) setOverCardOpen(true);
    prevOverRef.current = state.over;
  }, [state.over]);
  // Pending clears so overlapping actions don't orphan timers.
  const timers = useRef<number[]>([]);
  useEffect(() => () => {
    for (const t of timers.current) window.clearTimeout(t);
    fadeOutMusic();
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
      let latestDiscovery:
        | { out: string; recipe: string[]; firstLifetime: boolean }
        | null = null;
      let latestAgeUp: { age: number; sample: string[] } | null = null;

      // Outputs discovered in this batch — used to flash the forming cell
      // when the matching combine pops. (Discovery event precedes its combine
      // in the engine's event order.)
      const discoveredOuts = new Set<string>();

      // Immediate (non-combine) patch — placed/nope/crumble/discovery/age-up.
      const immediate: Fx = {};
      // Timeline of combine phases, each scheduled relative to time 0.
      const schedule: Array<{ at: number; patch: Fx; clearAt: number; clearKeys: (keyof Fx)[] }> = [];
      let cursor = 0;
      const FUSE_MS = 300;
      const POP_MS = 420;
      const DISCOVER_MS = 720;
      const CHAIN_FADE_MS = 900;

      // Group consecutive combine events into chains. Each `combine`
      // carries `mult` — a run starts at mult=1 and increments; a reset
      // (next mult<=current) ends the chain. We build one ChainTrace per
      // group so the overlay can draw the whole path across steps.
      type Group = { startIdx: number; endIdx: number; startAt: number };
      const groups: Group[] = [];
      {
        let current: Group | null = null;
        let localCursor = 0;
        for (let i = 0; i < events.length; i++) {
          const e = events[i];
          if (e.type === "combine") {
            if (current && e.mult > 1) {
              current.endIdx = i;
            } else {
              if (current) groups.push(current);
              current = { startIdx: i, endIdx: i, startAt: localCursor };
            }
            localCursor += FUSE_MS + POP_MS;
          } else if (e.type === "placed" || e.type === "nope") {
            // non-combine, non-blocking
          } else if (e.type === "shipped") {
            localCursor += 380;
          }
        }
        if (current) groups.push(current);
      }
      // Index of combine event → its group (or null if standalone single-step).
      const eventGroup = new Map<number, Group>();
      for (const g of groups) {
        if (g.endIdx > g.startIdx) {
          for (let i = g.startIdx; i <= g.endIdx; i++) eventGroup.set(i, g);
        }
      }

      // Per-group accumulator — the trace mounted at the group's start
      // grows as later steps in the same chain fire.
      const groupTrace = new Map<Group, { trace: ChainTrace; mountAt: number }>();

      for (let eIdx = 0; eIdx < events.length; eIdx++) {
        const e = events[eIdx];
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
          // If this combine's output is a new discovery, fire a sparkle
          // pulse on the forming cell right after the pop lands.
          if (discoveredOuts.has(e.out)) {
            const discoverAt = popAt + POP_MS;
            schedule.push({
              at: discoverAt,
              patch: { discover: e.at },
              clearAt: discoverAt + DISCOVER_MS,
              clearKeys: ["discover"],
            });
          }

          // Chain overlay: when this combine is part of a multi-step
          // chain, accumulate a trace that the <ChainOverlay> renders as
          // arcs between ingredients and output across all steps.
          const group = eventGroup.get(eIdx);
          if (group) {
            const outTier = bundle.items.get(e.out)?.tier ?? "M";
            let entry = groupTrace.get(group);
            if (!entry) {
              const trace: ChainTrace = {
                steps: [],
                members: new Set<number>(),
                tier: outTier,
                startedAt: 0,
              };
              entry = { trace, mountAt: fuseAt };
              groupTrace.set(group, entry);
            }
            entry.trace.steps.push({
              from: [...e.cells],
              to: e.at,
              tier: outTier,
              drawAt: fuseAt - entry.mountAt,
            });
            for (const c of e.cells) entry.trace.members.add(c);
            entry.trace.members.add(e.at);
            // The final output tier wins visual priority.
            entry.trace.tier = outTier;
            // If this is the last step of the group, schedule the mount
            // + clear now that the trace is complete.
            if (eIdx === group.endIdx) {
              const finalPopEnd = popAt + POP_MS;
              const traceSnapshot: ChainTrace = {
                steps: entry.trace.steps,
                members: entry.trace.members,
                tier: entry.trace.tier,
                startedAt: entry.mountAt,
              };
              schedule.push({
                at: entry.mountAt,
                patch: { trace: traceSnapshot },
                clearAt: finalPopEnd + CHAIN_FADE_MS,
                clearKeys: ["trace"],
              });
            }
          }

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
        } else if (e.type === "hold-crumble") {
          playFx("crumble");
        } else if (e.type === "discovery") {
          const firstLifetime = !collection.has(e.out);
          latestDiscovery = {
            out: e.out,
            recipe: e.recipe,
            firstLifetime,
          };
          discoveredOuts.add(e.out);
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
    [scheduleClear, collection, bundle.items],
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
        // Fire-and-forget: record the finished run in the user's account
        // stats. Signed-out users just skip this with a 401; we don't care.
        fetch("/api/combine/result", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            theme: r.state.theme,
            score: r.state.score,
            made: r.state.made,
            age: r.state.age,
            daily: r.state.daily,
            season: bundles[r.state.theme].theme.ages.length,
          }),
        }).catch(() => {});
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
            top: bestShelfId ? bundle.items.get(bestShelfId)?.name ?? null : null,
            found: r.state.found.length,
            longest: r.state.longest,
            shelf: r.state.shelf.length,
          };
          saveDailyDone(dr);
          setDailyDone(dr);
        }
      }
      // Record new discoveries into the lifetime collection. For signed-in
      // users this persists to Postgres; for signed-out users it accumulates
      // in memory only (lost on next game / reload — this is the gated
      // behaviour that makes signing in valuable).
      //
      // "Discovered" = outputs you've made (discovery events) ∪ base
      // ingredients you've used in a combo (combine event inputs that aren't
      // outputs anywhere in the theme). Base tiles that only ever sit in the
      // tray — never consumed — stay uncollected on purpose.
      const found: string[] = [];
      for (const e of r.events) {
        if (e.type === "discovery") {
          found.push(e.out);
        } else if (e.type === "combine") {
          for (const id of e.inputs) {
            if (!bundle.outputs.has(id)) found.push(id);
          }
        }
      }
      if (found.length) recordDiscoveries(found);
    },
    [state, bundle, applyEvents, best, recordDiscoveries],
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
        setState(
          newGame(which, nextBundle, {
            seed: freshEndlessSeed(),
            size: 6,
          }).state,
        );
      }
      resetTransient();
    },
    [state, bundles, resetTransient],
  );

  const restartTheme = useCallback(
    (which: ThemeKey) => {
      setState(
        newGame(which, bundles[which], {
          seed: freshEndlessSeed(),
          size: 6,
        }).state,
      );
      resetTransient();
    },
    [bundles, resetTransient],
  );

  const startDaily = useCallback(() => {
    const day = todayKey();
    // Resume today's daily save if any (including the finished state kept
    // for review). Only start a fresh daily when there's no save at all AND
    // today's puzzle hasn't been completed yet — otherwise we'd silently
    // let a player replay today's run.
    //
    // Order matters: loadDailyDone has to run first because, on a
    // DAILY_EPOCH mismatch, it side-effect-clears the review save slot.
    // If we read loadGame first we'd hydrate the stale finished state
    // instead of starting the fresh run the reset is meant to allow.
    const done = loadDailyDone(day);
    const saved = loadGame(bundles.everything, { daily: day });
    if (saved) {
      saveGame(state);
      setState(hydrateGame(saved));
    } else if (done) {
      // Done, but the final state is no longer in storage (older save or
      // storage got cleared). Nothing to resume into; keep the current
      // game as-is so the player doesn't accidentally start a replay.
      return;
    } else {
      saveGame(state);
      setState(
        newGame("everything", bundles.everything, {
          daily: day,
          size: 6,
          seed: dailySeed(day),
        }).state,
      );
    }
    resetTransient();
  }, [bundles, state, resetTransient]);

  const shareDaily = useCallback(async () => {
    const dr = dailyDone;
    if (!dr) return;
    // Legacy stored results may hold a raw uuid in `top`; resolve to a name
    // if we can, otherwise drop the field so we never leak a uuid.
    const topDisplay = (() => {
      if (!dr.top) return null;
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dr.top);
      if (!isUuid) return dr.top.charAt(0).toUpperCase() + dr.top.slice(1);
      const resolved = resolveItemName(dr.top, bundles.everything);
      return resolved && resolved !== dr.top ? resolved : null;
    })();
    const foundLine =
      dr.found && dr.found > 0
        ? ` · ${dr.found} new discover${dr.found > 1 ? "ies" : "y"}`
        : "";
    const chainLine = dr.longest && dr.longest > 1 ? ` · longest chain ×${dr.longest}` : "";
    const shelfLine =
      dr.shelf && dr.shelf > 0
        ? ` · ${dr.shelf} finished thing${dr.shelf > 1 ? "s" : ""}`
        : "";
    const text =
      `Made Of · Daily Combine ${dr.key}\n` +
      Array.from({ length: bundles.everything.theme.ages.length }, (_, k) =>
        k <= dr.age ? "🟩" : "⬜",
      ).join("") +
      ` reached Age ${dr.ageName}\n` +
      `${dr.score.toLocaleString("en")} points · ${dr.made} made${
        topDisplay ? ` · best: ${topDisplay}` : ""
      }${foundLine}${chainLine}${shelfLine}`;
    const query = dailyShareQuery(dr.key, {
      score: dr.score,
      age: dr.age,
      made: dr.made,
      ageName: dr.ageName,
      ageCount: bundles.everything.theme.ages.length,
      best: topDisplay,
      found: dr.found,
      longest: dr.longest,
      shelf: dr.shelf,
    });
    await shareText({
      title: "Made Of · Daily Combine",
      text,
      url: `https://madeof.app/combine?${query}`,
    });
  }, [dailyDone, bundles.everything]);

  const onCellTap = useCallback(
    (cell: number) => {
      // In a finished run (e.g. reviewing today's completed daily), the
      // board is inert except for tapping a tile to open its info card.
      if (state.over) {
        const target = state.board[cell];
        if (target != null) setInfoTile(target);
        return;
      }
      // Clear mode: tap a full cell to remove it.
      if (clearMode) {
        if (state.board[cell] == null) return;
        act({ type: "clear", cell });
        setClearMode(false);
        return;
      }
      // Shore mode: tap a crumbling tile to reset its counter.
      if (shoreMode) {
        const v = state.board[cell];
        const c = state.crumb[cell];
        if (!v || !c || c.id !== v) return;
        act({ type: "shore", cell });
        setShoreMode(false);
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
        act({
          type: "place",
          slot: selectedSlot.slot,
          cell,
          source: selectedSlot.source,
        });
      } else {
        act({
          type: "drop-on",
          slot: selectedSlot.slot,
          cell,
          source: selectedSlot.source,
        });
      }
    },
    [act, selectedSlot, state.board, state.crumb, state.over, clearMode, moveMode, shoreMode],
  );

  // When a drag completed via drop or a long-press fired, we don't want
  // the trailing click to toggle selection. Set when either path consumes
  // the pointerup, cleared on the next pointerdown.
  const suppressClick = useRef(false);

  const onSlotTap = useCallback(
    (source: "tray" | "hold", slot: number) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      setSelectedSlot((s) =>
        s && s.source === source && s.slot === slot ? null : { source, slot },
      );
    },
    [],
  );

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

  useEffect(() => {
    if (!moreOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".cbmoremenu")) return;
      if (target.closest("#cbMore")) return;
      setMoreOpen(false);
    };
    window.addEventListener("click", onDocClick);
    return () => window.removeEventListener("click", onDocClick);
  }, [moreOpen]);

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
      if (moreOpen) {
        setMoreOpen(false);
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
      if (shoreMode) {
        setShoreMode(false);
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
    moreOpen,
    clearMode,
    moveMode,
    shoreMode,
    selectedSlot,
  ]);

  // Drag state is held in a ref for the hot path (pointermove), mirrored
  // to React state only when the over-cell changes so cells can light up.
  const dragRef = useRef<{
    slot: number;
    source: "tray" | "hold";
    x0: number;
    y0: number;
    moved: boolean;
    tileWidth: number;
    holdTimer: number | null;
    overCell: number | null;
    overHold: boolean;
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
    // Drop onto the hold zone: tray → hold stashes; hold → hold is a no-op.
    if (snapshot?.overHold) {
      if (d.source === "tray") {
        act({ type: "hold", slot: d.slot });
      }
      return;
    }
    if (snapshot?.overCell != null && snapshot.overOk) {
      const cell = snapshot.overCell;
      const target = state.board[cell];
      if (target == null) {
        act({ type: "place", slot: d.slot, cell, source: d.source });
      } else {
        act({ type: "drop-on", slot: d.slot, cell, source: d.source });
      }
    } else {
      setSelectedSlot(null);
    }
  }, [act, drag, state.board]);

  // Capture the drop target under the pointer and whether a drop there is
  // valid. Returns the board cell (and whether a combine would form) OR a
  // hold-zone hit — never both.
  const captureOver = useCallback(
    (x: number, y: number): { cell: number | null; ok: boolean; hold: boolean } => {
      const el = document.elementFromPoint(x, y);
      const d = dragRef.current;
      if (d == null) return { cell: null, ok: false, hold: false };
      // Hold-zone hit: only accept from the tray and only if there's room.
      if (el?.closest("[data-cbholdzone]")) {
        if (d.source !== "tray") return { cell: null, ok: false, hold: false };
        const roomy = state.hold.some((v) => v == null);
        return { cell: null, ok: roomy, hold: true };
      }
      const cellEl = el?.closest("[data-cb]") as HTMLElement | null;
      if (!cellEl) return { cell: null, ok: false, hold: false };
      const cell = Number(cellEl.dataset.cb);
      const src = d.source === "hold" ? state.hold : state.tray;
      const tile = src[d.slot];
      if (tile == null) return { cell, ok: false, hold: false };
      const target = state.board[cell];
      const ok =
        target == null
          ? true
          : Boolean(matchOn(bundle, state.board, cell, tile, state.n));
      return { cell, ok, hold: false };
    },
    [bundle, state.board, state.hold, state.n, state.tray],
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
        setSelectedSlot({ source: d.source, slot: d.slot });
      }
      const over = captureOver(e.clientX, e.clientY);
      d.overCell = over.cell;
      d.overHold = over.hold;
      setDrag((cur) =>
        cur
          ? {
              ...cur,
              x: e.clientX,
              y: e.clientY,
              overCell: over.cell,
              overOk: over.ok,
              overHold: over.hold,
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
    (
      slot: number,
      source: "tray" | "hold",
      e: React.PointerEvent<HTMLButtonElement>,
    ) => {
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const tile = (source === "hold" ? state.hold : state.tray)[slot];
      if (tile == null) return;
      suppressClick.current = false;
      dragRef.current = {
        slot,
        source,
        x0: e.clientX,
        y0: e.clientY,
        moved: false,
        tileWidth: rect.width,
        holdTimer: null,
        overCell: null,
        overHold: false,
      };
      setDrag({
        slot,
        source,
        x: e.clientX,
        y: e.clientY,
        tileWidth: rect.width,
        overCell: null,
        overOk: false,
        overHold: false,
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
    [state.hold, state.tray],
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
    for (const id of collection.keys()) found.add(id);
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
  }, [bundle, state.age, state.tray, state.found, collection]);

  const onHelper = useCallback(
    (which: "hint" | "swap" | "clear" | "move" | "shore" | "undo") => {
      setHelpersOpen(false);
      // Undo rewinds the last placement/drop/move. Blocked by the
      // engine when the last turn produced a discovery (so daily
      // scope stays safe from unlock-then-undo gaming).
      if (which === "undo") {
        if (state.undos <= 0 || !state.lastSnapshot || state.over) return;
        setClearMode(false);
        setMoveMode(null);
        setShoreMode(false);
        setSelectedSlot(null);
        act({ type: "undo" });
        return;
      }
      // Entering move/clear/shore cancels selection and any opposing mode.
      if (which === "clear") {
        if (state.clears <= 0 || state.over) return;
        setMoveMode(null);
        setShoreMode(false);
        setSelectedSlot(null);
        setClearMode((m) => !m);
        return;
      }
      if (which === "move") {
        if (state.mv <= 0 || state.over) return;
        setClearMode(false);
        setShoreMode(false);
        setSelectedSlot(null);
        setMoveMode((m) => (m ? null : { from: null }));
        return;
      }
      if (which === "shore") {
        if (state.shore <= 0 || state.over) return;
        setClearMode(false);
        setMoveMode(null);
        setSelectedSlot(null);
        setShoreMode((m) => !m);
        return;
      }
      if (which === "swap") {
        if (state.swaps <= 0) return;
        setClearMode(false);
        setMoveMode(null);
        setShoreMode(false);
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
    [
      act,
      state.clears,
      state.mv,
      state.swaps,
      state.hints,
      state.shore,
      state.undos,
      state.lastSnapshot,
      state.over,
      findHint,
    ],
  );

  const preview = useMemo(
    () => computePreview(bundle, state, selectedSlot, collection.keys()),
    [bundle, state, selectedSlot, collection],
  );

  // Merged "known" set for UI affordances (preview glow, info card goes-into
  // list, choice picker ordering). Signed-in players carry their lifetime
  // collection in here; signed-out players only have this-game finds.
  const knownIds = useMemo(() => {
    const s = new Set<string>(state.found);
    for (const id of collection.keys()) s.add(id);
    return s;
  }, [state.found, collection]);

  const activeAgeBanner = newAgeBanner[state.theme];
  const dismissAgeBanner = () => {
    const curr = bundles[state.theme].theme.ages.length;
    saveSeenAges(state.theme, curr);
    setNewAgeBanner((prev) => {
      const next = { ...prev };
      delete next[state.theme];
      return next;
    });
  };

  return (
    <div className="cbwrap">
      {activeAgeBanner && (
        <div className="cbagebanner" role="status">
          <span>
            A new age has emerged — <b>{activeAgeBanner}</b>
          </span>
          <button
            type="button"
            className="cbagebanner-x"
            onClick={dismissAgeBanner}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <div id="cb">
        <TopBar
          state={state}
          fx={fx}
          best={best[state.theme] ?? 0}
          helpersOpen={helpersOpen}
          clearMode={clearMode}
          moveMode={moveMode != null}
          shoreMode={shoreMode}
          soundOn={sound.music !== "off" || sound.sfx}
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
            if (shoreMode) {
              setShoreMode(false);
              return;
            }
            setHelpersOpen((o) => !o);
          }}
          onHelper={onHelper}
          onTheme={() => setThemeOpen(true)}
          moreOpen={moreOpen}
          onToggleMore={() => setMoreOpen((o) => !o)}
          onBook={() => {
            setMoreOpen(false);
            setBookOpen(true);
          }}
          onSound={() => {
            setMoreOpen(false);
            setSoundOpen(true);
          }}
          onHelp={() => {
            setMoreOpen(false);
            setHelpOpen(true);
          }}
        />
        <TipLine
          state={state}
          hasSelection={selectedSlot != null}
          preview={preview}
          clearMode={clearMode}
          moveMode={moveMode}
          shoreMode={shoreMode}
        />
        <AgeBar
          state={state}
          bundle={bundle}
          onAges={() => setAgesOpen(true)}
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
          shoreMode={shoreMode}
          onCellTap={onCellTap}
        />
        <Hold
          state={state}
          bundle={bundle}
          active={Boolean(drag?.overHold)}
          activeOk={Boolean(drag?.overHold && drag.overOk)}
          selected={selectedSlot}
          onSlotTap={onSlotTap}
          onSlotPointerDown={onSlotPointerDown}
          onHoldTap={() => {
            // A trailing click from a completed drag (drop onto hold)
            // must not re-fire the hold action.
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            if (selectedSlot?.source !== "tray") return;
            if (!state.hold.some((v) => v == null)) return;
            act({ type: "hold", slot: selectedSlot.slot });
            setSelectedSlot(null);
          }}
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
            known={knownIds}
            onChoose={onChoose}
          />
        )}
        {state.over && overCardOpen && (
          <GameOverCard
            state={state}
            bundle={bundle}
            collection={collection}
            best={best[state.theme] ?? 0}
            onClose={() => setOverCardOpen(false)}
            onPlayAgain={() => {
              // From a finished daily, "Play endless" starts a fresh
              // endless game. From endless, start another endless.
              const nextTheme = state.theme;
              const nextDaily = null;
              setState(
                newGame(nextTheme, bundles[nextTheme], {
                  daily: nextDaily,
                  seed: freshEndlessSeed(),
                  size: 6,
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
        {state.over && !overCardOpen && (
          <div className="cbresultsrow">
            <button
              type="button"
              className="cbh cbresults"
              onClick={() => setOverCardOpen(true)}
            >
              Results
            </button>
            <button
              type="button"
              className="cbh"
              onClick={async () => {
                const payload = state.daily
                  ? dailyShareText(state.daily, state, bundle)
                  : endlessShareText(state, bundle);
                await shareText(payload);
              }}
            >
              Share
            </button>
          </div>
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
            known={knownIds}
            howMade={state.howMade}
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
            onRestart={(which) => {
              setThemeOpen(false);
              restartTheme(which);
            }}
            onDismiss={() => setThemeOpen(false)}
          />
        )}
        {bookOpen && (
          <CollectionBook
            bundle={bundle}
            state={state}
            collection={collection}
            authed={collectionAuthed}
            authPending={collectionPending}
            onInfo={(id) => setInfoTile(id)}
            onDismiss={() => setBookOpen(false)}
          />
        )}
        {agesOpen && (
          <AgesSheet
            state={state}
            bundle={bundle}
            onInfo={(id) => setInfoTile(id)}
            onDismiss={() => setAgesOpen(false)}
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
            {
              glyph: <GlyphCrumble />,
              title: "Old things crumble away",
              body: "When nothing in the current age needs a tile, a red counter ticks down from 3. On the 4th turn it falls off the board — combine it, move it on, or shore it up before it goes.",
            },
          ]}
          footnote="Need a nudge mid-run? Use the Helpers button for a hint, a swap, a clear, a move or a shore."
        />
      </div>
      {drag &&
        drag.slot != null &&
        (drag.source === "hold" ? state.hold : state.tray)[drag.slot] != null && (
          <DragGhost
            tileId={(drag.source === "hold" ? state.hold : state.tray)[drag.slot]!}
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
  known,
  howMade,
  onDismiss,
}: {
  tileId: string;
  bundle: ThemeBundle;
  /** Everything the player knows (this game + lifetime collection). */
  known: Set<string>;
  /** Ingredients the player actually used to make each output this run.
   *  When present for `tileId`, it wins over the bundle's canonical recipe
   *  so items with multiple valid recipes show the one the player made. */
  howMade: Record<string, string[]>;
  onDismiss: () => void;
}) {
  const item = bundle.items.get(tileId);
  if (!item) return null;
  // Only reveal a recipe the player has earned the right to see — either
  // because they made it this run, or because the output is already known
  // (previous run, lifetime collection, or raw starting item). Otherwise
  // hide ingredients so long-pressing a tile can't be used to peek at how
  // to craft an undiscovered item.
  const playerRecipe = howMade[tileId];
  const isKnown = known.has(tileId);
  const bundleRecipe = isKnown
    ? bundle.recipes.find((r) => r.out === tileId)
    : undefined;
  const loreRecipe = isKnown && item.lore ? { all: item.lore } : null;
  const madeFrom: { all: string[] } | null = playerRecipe
    ? { all: playerRecipe }
    : (bundleRecipe ?? loreRecipe);
  // Goes into: recipes that use this tile as an ingredient.
  const goesInto = (bundle.byIngredient.get(tileId) ?? []).filter(
    (r) => r.out !== tileId,
  );
  const foundGoesInto = goesInto.filter((r) => known.has(r.out));
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
        ) : isKnown ? (
          <p className="fact">A raw thing.</p>
        ) : (
          <p className="fact">You haven&rsquo;t made this yet.</p>
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
          <a className="cbh" href={`/explore/${item.slug}`}>
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
  collection,
  best,
  onClose,
  onPlayAgain,
  onShare,
}: {
  state: GameState;
  bundle: ThemeBundle;
  collection: Map<string, number>;
  best: number;
  onClose: () => void;
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
  // "N of Y discovered so far" is a lifetime figure, so merge this run's
  // new finds with the lifetime collection (mirrors CollectionBook).
  const themeDiscoveredSet = new Set<string>();
  for (const id of collection.keys()) {
    if (bundle.outputs.has(id)) themeDiscoveredSet.add(id);
  }
  for (const id of state.found) {
    if (bundle.outputs.has(id)) themeDiscoveredSet.add(id);
  }
  const themeDiscovered = themeDiscoveredSet.size;
  const totalOutputs = bundle.outputs.size;
  return (
    <>
      <div className="cbscrim" onClick={onClose} />
      <section className="cbover" role="dialog" aria-label="Run over">
        <button
          type="button"
          className="cbx"
          aria-label="View board"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <span className="k">{state.daily ? `Daily game · ${state.daily}` : "Board full"}</span>
        <b className="big">{state.score.toLocaleString("en")}</b>
        <span className="sub">
          {newBest
            ? "A new best!"
            : best > state.score
              ? `Your best is ${best.toLocaleString("en")}. ${(best - state.score).toLocaleString("en")} to go.`
              : `You reached Age ${ageName}.`}
        </span>
        <div className="cb3">
          <div>
            <b>{state.shelf.length}</b>
            <span>finished things</span>
          </div>
          <div>
            <b>{ageName}</b>
            <span>age reached</span>
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
  onRestart,
  onDismiss,
}: {
  bundles: Record<ThemeKey, ThemeBundle>;
  daily: string | null;
  current: ThemeKey;
  dailyDone: DailyResult | null;
  onPickTheme: (which: ThemeKey) => void;
  onPickDaily: () => void;
  onShareDaily: () => void;
  onRestart: (which: ThemeKey) => void;
  onDismiss: () => void;
}) {
  const [confirmRestart, setConfirmRestart] = useState(false);
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
          <div
            className="cbtopt cbdaily done"
            role="button"
            tabIndex={0}
            onClick={onPickDaily}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPickDaily();
              }
            }}
          >
            <b>Daily game · done · review</b>
            <span>
              {dailyDone.score.toLocaleString("en")} points · reached Age{" "}
              {dailyDone.ageName}. A new one tomorrow.
            </span>
            <button
              type="button"
              className="cbh"
              onClick={(e) => {
                e.stopPropagation();
                onShareDaily();
              }}
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
              Same start and same tiles for everyone today. One go. 6×6.
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
        {!daily && !confirmRestart && (
          <button
            type="button"
            className="cbh cbrestart"
            onClick={() => setConfirmRestart(true)}
            style={{ width: "100%", justifyContent: "center" }}
          >
            Restart {bundles[current].theme.name}
          </button>
        )}
        {!daily && confirmRestart && (
          <div className="cbrestartconfirm">
            <p>
              End this run and start a fresh {bundles[current].theme.name}
              {" "}game? Your current score and board will be lost.
            </p>
            <div className="cbrestartrow">
              <button
                type="button"
                className="cbh"
                onClick={() => setConfirmRestart(false)}
                style={{ flex: 1, justifyContent: "center" }}
              >
                Keep playing
              </button>
              <button
                type="button"
                className="cbh cbrestart"
                onClick={() => {
                  setConfirmRestart(false);
                  onRestart(current);
                }}
                style={{ flex: 1, justifyContent: "center" }}
              >
                Restart
              </button>
            </div>
          </div>
        )}
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
  collection,
  authed,
  authPending,
  onInfo,
  onDismiss,
}: {
  bundle: ThemeBundle;
  state: GameState;
  /** Lifetime finds: itemId → firstFoundAt epoch ms. Signed-in users carry
   *  this across games; signed-out users accumulate it only in memory. */
  collection: Map<string, number>;
  authed: boolean;
  authPending: boolean;
  onInfo: (id: string) => void;
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
  // record() call, but merging keeps the UI robust).
  const findsForTheme = useMemo(() => {
    const now = Date.now();
    const merged = new Map<string, number>();
    for (const [id, t] of collection) {
      if (collectables.has(id)) merged.set(id, t);
    }
    for (const id of state.found) {
      if (!merged.has(id) && collectables.has(id)) merged.set(id, now);
    }
    return merged;
  }, [collection, state.found, collectables]);
  const got = findsForTheme.size;
  const pct = Math.round((100 * got) / Math.max(1, total));
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<"recent" | "alpha" | "kind" | "age">("recent");
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
      case "age":
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
    <>
      <div className="cbscrim" onClick={onDismiss} />
      <section
        className="cbover cbbook"
        role="dialog"
        aria-label="Collection"
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
              <option value="age">Age</option>
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
                return (
                  <button
                    key={id}
                    type="button"
                    className="cbbookrow"
                    onClick={() => {
                      onInfo(id);
                      onDismiss();
                    }}
                  >
                    <span className="cbbookrow-head">
                      <span
                        className="cbslot"
                        style={fillVar(it)}
                        aria-hidden="true"
                      >
                        <Pictogram
                          name={it.name}
                          tier={it.tier}
                          kind={it.kind}
                          symbol={it.symbol}
                        />
                      </span>
                      <span className="cbbookrow-text">
                        <b>{cap(it.name)}</b>
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
                          <span key={i} className="cbrcp">
                            {r.all.map((ing, k) => {
                              const ingIt = bundle.items.get(ing);
                              const name = ingIt ? cap(ingIt.name) : ing;
                              return (
                                <React.Fragment key={k}>
                                  {k > 0 && <i>+</i>}
                                  <span>
                                    {ingIt && (
                                      <span
                                        className="ic"
                                        aria-hidden="true"
                                      >
                                        <Pictogram
                                          name={ingIt.name}
                                          tier={ingIt.tier}
                                          kind={ingIt.kind}
                                          symbol={ingIt.symbol}
                                        />
                                      </span>
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
                        <Pictogram
                          name={it.name}
                          tier={it.tier}
                          kind={it.kind}
                          symbol={it.symbol}
                        />
                        <span>{cap(it.name)}</span>
                        <small>{relativeTime(foundAt)}</small>
                      </button>
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
      </section>
    </>
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
    <div
      className="cbdisc cbagetoast cbagebig"
      role="status"
      onClick={onDismiss}
    >
      <span className="cbagesweep" aria-hidden="true" />
      <div className="cbagebody">
        <span className="k">New age · tap to close</span>
        <b>Age {ageName}</b>
        <p>
          New things start arriving. Old ones nobody needs will crumble
          away.
        </p>
        {toast.sample.length > 0 && (
          <div className="cbrcp cbagesample">
            {toast.sample.map((id, i) => {
              const it = bundle.items.get(id);
              if (!it) return null;
              return (
                <span
                  key={id}
                  style={{ "--i": i } as React.CSSProperties}
                >
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
  discovery: { out: string; recipe: string[]; firstLifetime: boolean };
  bundle: ThemeBundle;
  onDismiss: () => void;
}) {
  const item = bundle.items.get(discovery.out);
  if (!item) return null;
  return (
    <div
      className={`cbdisc${discovery.firstLifetime ? " cbfirst" : ""}`}
      role="status"
      onClick={onDismiss}
      style={fillVar(item)}
    >
      <span className="cbdisc-pic">
        <Pictogram
          name={item.name}
          tier={item.tier}
          kind={item.kind}
          symbol={item.symbol}
        />
      </span>
      <div>
        <span className="k">
          {discovery.firstLifetime
            ? "First time! · tap to close"
            : "New discovery · tap to close"}
        </span>
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
  moreOpen,
  clearMode,
  moveMode,
  shoreMode,
  soundOn,
  onToggleHelpers,
  onToggleMore,
  onHelper,
  onTheme,
  onBook,
  onSound,
  onHelp,
}: {
  state: GameState;
  fx: Fx;
  best: number;
  helpersOpen: boolean;
  moreOpen: boolean;
  clearMode: boolean;
  moveMode: boolean;
  shoreMode: boolean;
  soundOn: boolean;
  onToggleHelpers: () => void;
  onToggleMore: () => void;
  onHelper: (which: "hint" | "swap" | "clear" | "move" | "shore" | "undo") => void;
  onTheme: () => void;
  onBook: () => void;
  onSound: () => void;
  onHelp: () => void;
}) {
  const canUndo = state.undos > 0 && state.lastSnapshot != null;
  const helpersLeft =
    state.swaps +
    state.clears +
    state.hints +
    state.mv +
    state.shore +
    (canUndo ? 1 : 0);
  const themeName = state.daily ? "Daily" : "Endless";
  const bestDisplay = Math.max(best, state.over ? state.score : 0);
  const modeActive = clearMode || moveMode || shoreMode;
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
          <>
            <div className="cbscrim cbhelpscrim" aria-hidden="true" />
            <div className="cbhelpmenu" role="menu" aria-label="Helpers">
            <span className="k cbhelptitle">Helpers</span>
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
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("shore")}
              disabled={state.shore === 0}
              aria-label={`Shore up a crumbling tile, ${state.shore} left`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20h16M6 20V11l6-6 6 6v9M9 20v-6h6v6" />
              </svg>
              <span className="nm">
                <b className="t">Shore</b>
                <em>
                  Anchor a crumbling tile — it won&apos;t crumble again.
                </em>
              </span>
              <b className="c">{state.shore}</b>
            </button>
            <button
              type="button"
              className="cbhm"
              onClick={() => onHelper("undo")}
              disabled={!canUndo}
              aria-label={
                canUndo
                  ? `Undo last move, ${state.undos} left`
                  : state.undos > 0
                    ? "Undo unavailable — no move to undo or last turn unlocked something"
                    : "Undo used"
              }
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 14l-5-5 5-5M4 9h10a6 6 0 0 1 0 12h-4" />
              </svg>
              <span className="nm">
                <b className="t">Undo</b>
                <em>
                  Take back your last tile. Can&apos;t undo past a new discovery.
                </em>
              </span>
              <b className="c">{state.undos}</b>
            </button>
            </div>
          </>
        )}
      </div>
      <div className="cbmorewrap">
        <button
          type="button"
          id="cbMore"
          className={`cbsnd${moreOpen ? " on" : ""}`}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="More"
          title="More"
          onClick={onToggleMore}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        </button>
        {moreOpen && (
          <>
            <div className="cbscrim cbhelpscrim" aria-hidden="true" />
            <div className="cbmoremenu cbhelpmenu" role="menu" aria-label="More">
              <span className="k cbhelptitle">More</span>
              <button
                type="button"
                className="cbhm"
                onClick={onBook}
                aria-label="Open collection"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5c3-1 6-1 8 1v14c-2-2-5-2-8-1zM20 5c-3-1-6-1-8 1v14c2-2 5-2 8-1z" />
                </svg>
                <span className="nm">
                  <b className="t">Collection</b>
                  <em>Everything you&apos;ve ever found</em>
                </span>
              </button>
              <button
                type="button"
                className="cbhm"
                onClick={onSound}
                aria-label="Music and sound settings"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 9h4l5-4v14l-5-4H4z" />
                  {soundOn ? (
                    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
                  ) : (
                    <path d="M17 9l5 6M22 9l-5 6" />
                  )}
                </svg>
                <span className="nm">
                  <b className="t">Music &amp; sound</b>
                  <em>{soundOn ? "On" : "Off"}</em>
                </span>
              </button>
              <button
                type="button"
                className="cbhm"
                onClick={onHelp}
                aria-label="How to play"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M9.3 9.2a2.7 2.7 0 1 1 4.2 2.4c-1 .6-1.5 1.2-1.5 2.4" />
                  <circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none" />
                </svg>
                <span className="nm">
                  <b className="t">How to play</b>
                  <em>Rules and tips</em>
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TipLine({
  state,
  hasSelection,
  preview,
  clearMode,
  moveMode,
  shoreMode,
}: {
  state: GameState;
  hasSelection: boolean;
  preview: Map<number, Preview>;
  clearMode: boolean;
  moveMode: { from: number | null } | null;
  shoreMode: boolean;
}) {
  let tip: string;
  if (state.over) tip = "Game over.";
  else if (state.choosing) tip = "These make more than one thing. Pick one.";
  else if (clearMode) tip = "Tap a tile to clear it.";
  else if (shoreMode) tip = "Tap a crumbling tile to steady it.";
  else if (moveMode) {
    if (moveMode.from == null) tip = "Tap the tile you want to move.";
    else {
      const name = state.board[moveMode.from];
      tip = `Now tap where the ${name ? cap(name).toLowerCase() : "tile"} should go. Moving isn't a turn.`;
    }
  } else if (hasSelection) {
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
  onAges,
}: {
  state: GameState;
  bundle: ThemeBundle;
  onAges: () => void;
}) {
  const ages = bundle.theme.ages;
  const last = state.age >= ages.length - 1;
  const need = 7 + 2 * state.age;
  const pct = last ? 100 : Math.min(100, Math.round((state.ageMade / need) * 100));
  const ariaLabel = `Age ${ages[state.age]} of ${ages.length}${
    last ? "" : `. Make ${need - state.ageMade} more Age ${ages[state.age]} combos to reach Age ${ages[state.age + 1]}`
  }. Tap for details.`;
  return (
    <div className="cbage">
      <button
        type="button"
        className="cbageinfo"
        aria-label={ariaLabel}
        onClick={onAges}
      >
        <span className="bar">
          <i style={{ width: `${pct}%` }} />
          <span className="an">{ages[state.age]}</span>
          <span className="nx">
            {last ? "Final age" : `${state.ageMade}/${need} → ${ages[state.age + 1]}`}
          </span>
        </span>
      </button>
    </div>
  );
}

function AgesSheet({
  state,
  bundle,
  onInfo,
  onDismiss,
}: {
  state: GameState;
  bundle: ThemeBundle;
  onInfo: (id: string) => void;
  onDismiss: () => void;
}) {
  const ages = bundle.theme.ages;
  const current = state.age;
  const last = current >= ages.length - 1;
  const need = 7 + 2 * current;
  const left = Math.max(0, need - state.ageMade);
  // Group this run's discoveries by the age the player actually made them
  // in (recipe.band at make time), falling back to the item's canonical
  // min-band for older saves that predate `madeAtBand`.
  const foundByBand = useMemo(() => {
    const bandOf = new Map<string, number>();
    for (const r of bundle.recipes) {
      const cur = bandOf.get(r.out);
      if (cur == null || r.band < cur) bandOf.set(r.out, r.band);
    }
    const m = new Map<number, string[]>();
    for (const id of state.found) {
      const b = state.madeAtBand[id] ?? bandOf.get(id);
      if (b == null) continue;
      let list = m.get(b);
      if (!list) {
        list = [];
        m.set(b, list);
      }
      list.push(id);
    }
    return m;
  }, [bundle, state.found]);
  // One canonical chain per theme + age index. Hand-picked by item name so
  // the diagram tells a clear "raw → refined → made" story. Items in the
  // bundle are keyed by UUID; we resolve name → id here. If a name goes
  // missing (KB rename, etc.) we drop that node and the row still renders.
  const nameToId = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, it] of bundle.items) m.set(it.name.toLowerCase(), id);
    return m;
  }, [bundle]);
  const chainNames = AGE_CHAINS[state.theme]?.[current] ?? [];
  const chain = chainNames
    .map((name) => nameToId.get(name.toLowerCase()))
    .filter((id): id is string => id != null);
  return (
    <>
      <div className="cbscrim cbagescrim" onClick={onDismiss} />
      <section
        className="cbover cbagesheet"
        role="dialog"
        aria-label="Ages"
      >
        <span className="k">Ages</span>
        <h3>
          Age {ages[current]} — step {current + 1} of {ages.length}
        </h3>
        <p>
          Make combos at Age {ages[current]} to advance. Each successful
          Age-{ages[current]} combo counts — chains and makes at earlier
          ages don&apos;t.
          {last
            ? " You're on the final step — keep combining to push your score higher."
            : ` ${left} more Age-${ages[current]} combo${left === 1 ? "" : "s"} and you unlock ${ages[current + 1]}.`}
        </p>
        {chain.length >= 2 && (
          <div className="cbageex">
            <b>Age {ages[current]} looks like this</b>
            <div className="cbagechain" aria-label={`Example chain from raw to Age ${ages[current]}`}>
              {chain.map((id, i) => {
                const it = bundle.items.get(id);
                if (!it) return null;
                return (
                  <span key={id} className="cbagechainnode">
                    <span
                      className="cbslot"
                      style={fillVar(it)}
                      title={cap(it.name)}
                      aria-label={cap(it.name)}
                    >
                      <Pictogram
                        name={it.name}
                        tier={it.tier}
                        kind={it.kind}
                        symbol={it.symbol}
                      />
                    </span>
                    <em>{cap(it.name)}</em>
                    {i < chain.length - 1 && (
                      <span className="cbagechainarrow" aria-hidden="true">
                        →
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <ol className="cbagelist">
          {ages.map((name, i) => {
            const isNow = i === current;
            const isPast = i < current;
            const metaNeed = 7 + 2 * i;
            const meta = isNow
              ? last
                ? "Final"
                : `${state.ageMade}/${metaNeed}`
              : isPast
                ? "Done"
                : `Needs ${metaNeed}`;
            const finds = foundByBand.get(i + 1) ?? [];
            return (
              <li
                key={name}
                className={`cbagerow${isNow ? " on" : ""}${isPast ? " past" : ""}`}
              >
                <div className="cbagerow-top">
                  <b className="cbageno">{name}</b>
                  <span className="cbagemeta">{meta}</span>
                </div>
                {finds.length > 0 && (
                  <div className="cbagefinds" aria-label={`Found in Age ${name}`}>
                    {finds.map((id) => {
                      const it = bundle.items.get(id);
                      if (!it) return null;
                      return (
                        <button
                          key={id}
                          type="button"
                          className="cbslot"
                          style={fillVar(it)}
                          title={cap(it.name)}
                          aria-label={`${cap(it.name)}. Show how it's made`}
                          onClick={() => onInfo(id)}
                        >
                          <Pictogram
                            name={it.name}
                            tier={it.tier}
                            kind={it.kind}
                            symbol={it.symbol}
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
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
      <span className="cbshelf-slots">
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
        {!empty && <span className="cbslot cbslot-next" aria-hidden="true" />}
        {empty &&
          Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className="cbslot cbslot-ph" aria-hidden="true" />
          ))}
      </span>
      {empty && (
        <span className="cbshelf-empty">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
            <path d="M12 7v5l3 2" />
          </svg>
          <em>History</em>
        </span>
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
  shoreMode,
  onCellTap,
}: {
  state: GameState;
  bundle: ThemeBundle;
  fx: Fx;
  preview: Map<number, Preview>;
  dragOver: { cell: number | null; ok: boolean } | null;
  clearMode: boolean;
  moveMode: { from: number | null } | null;
  shoreMode: boolean;
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
        const isShored = state.shored[i] === true;
        const isShoreable = shoreMode && crumbleTick > 0 && !isShored;
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
            shoreable={isShoreable}
            shored={isShored}
            onTap={() => onCellTap(i)}
          />
        );
      })}
      {fx.trace && <ChainOverlay trace={fx.trace} />}
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
  shoreable,
  shored,
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
  shoreable: boolean;
  shored: boolean;
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
  const isDiscover = fx.discover === cell;
  const inChain = fx.trace?.members.has(cell) ?? false;

  const classes = ["cbc"];
  if (!empty) classes.push("full");
  if (isPlaced) classes.push("placed");
  if (inFuse) classes.push("fuse");
  if (isPop) classes.push("cbpopc");
  if (isDiscover) classes.push("cbdiscovered");
  if (inChain) classes.push("cbchainm");
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
  if (shoreable) classes.push("shoreable");
  if (shored) classes.push("shored");

  const words = displayId ? displayId.split("-") : [];
  const longest = Math.max(0, ...words.map((w) => w.length));
  const lenClass = longest >= 10 ? " l2" : longest >= 7 ? " l1" : "";

  const ariaLabel = item
    ? `${cap(item.name)}${
        shored
          ? ", shored: won't crumble"
          : crumbleTick > 0
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
      style={{
        ...(item ? fillVar(item) : {}),
        ...(inChain && fx.trace
          ? ({ "--chain-tier": `var(--f${fx.trace.tier})` } as React.CSSProperties)
          : {}),
      }}
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
      {isDiscover && <span className="cbspark" aria-hidden="true" />}
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
  selected: { source: "tray" | "hold"; slot: number } | null;
  onSlotTap: (source: "tray" | "hold", slot: number) => void;
  onSlotPointerDown: (
    slot: number,
    source: "tray" | "hold",
    e: React.PointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  const isSel = (slot: number) =>
    selected?.source === "tray" && selected.slot === slot;
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
        if (isSel(slot)) classes.push("sel");
        const isTool = bundle.tools.has(id);
        return (
          <button
            key={slot}
            type="button"
            className={classes.join(" ")}
            data-cbp={slot}
            style={fillVar(item)}
            onPointerDown={(e) => onSlotPointerDown(slot, "tray", e)}
            onClick={() => onSlotTap("tray", slot)}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={`Tray slot ${slot + 1}: ${cap(item.name)}${isSel(slot) ? ", selected" : ""}`}
            aria-pressed={isSel(slot)}
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

function Hold({
  state,
  bundle,
  active,
  activeOk,
  selected,
  onSlotTap,
  onSlotPointerDown,
  onHoldTap,
}: {
  state: GameState;
  bundle: ThemeBundle;
  /** True while a tray tile is being dragged and the pointer is over the
   *  zone — tells CSS to highlight the drop target. */
  active: boolean;
  /** True iff `active` and the drop would succeed (zone has room). When
   *  active but not ok, the zone paints a reject state. */
  activeOk: boolean;
  /** Currently selected slot (tap-to-select), if any. A tray selection
   *  tapped on the zone stashes the tile; a hold selection shows the
   *  held tile as active so it can be placed on a board cell. */
  selected: { source: "tray" | "hold"; slot: number } | null;
  onSlotTap: (source: "tray" | "hold", slot: number) => void;
  onSlotPointerDown: (
    slot: number,
    source: "tray" | "hold",
    e: React.PointerEvent<HTMLButtonElement>,
  ) => void;
  onHoldTap: () => void;
}) {
  const empty = state.hold.every((v) => v == null);
  const hasRoom = state.hold.some((v) => v == null);
  const tapReady = selected?.source === "tray" && hasRoom;
  const isSel = (slot: number) =>
    selected?.source === "hold" && selected.slot === slot;
  const classes = ["cbshelf", "cbhold"];
  if (empty) classes.push("none");
  if (active) classes.push(activeOk ? "over" : "over-bad");
  if (tapReady) classes.push("tap-ready");
  return (
    <div
      className={classes.join(" ")}
      data-cbholdzone="1"
      aria-label="Hold — drag or tap a tile here to save for later. Held tiles crumble when the age moves past them."
      onClick={(e) => {
        if (selected?.source !== "tray") return;
        // Ignore clicks that originated on a held-tile button; those have
        // their own tap behaviour (select/drag).
        if ((e.target as HTMLElement).closest(".cbheld")) return;
        onHoldTap();
      }}
    >
      <span className="cbshelf-slots">
        {state.hold.map((id, slot) => {
          if (id == null) {
            return (
              <span
                key={`ph-${slot}`}
                className="cbslot cbslot-ph"
                aria-hidden="true"
              />
            );
          }
          const item = bundle.items.get(id);
          if (!item) return null;
          const slotClasses = ["cbslot", "cbheld"];
          if (isSel(slot)) slotClasses.push("sel");
          return (
            <button
              key={slot}
              type="button"
              className={slotClasses.join(" ")}
              style={fillVar(item)}
              onPointerDown={(e) => onSlotPointerDown(slot, "hold", e)}
              onClick={() => onSlotTap("hold", slot)}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={`Held: ${cap(item.name)}${isSel(slot) ? ", selected" : ""}`}
              aria-pressed={isSel(slot)}
            >
              <Pictogram
                name={item.name}
                tier={item.tier}
                kind={item.kind}
                symbol={item.symbol}
              />
            </button>
          );
        })}
      </span>
      {empty && (
        <span className="cbshelf-empty" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3h12v18l-6-4-6 4z" />
          </svg>
          <em>Hold zone</em>
        </span>
      )}
    </div>
  );
}

function ChoicePicker({
  state,
  bundle,
  known,
  onChoose,
}: {
  state: GameState;
  bundle: ThemeBundle;
  known: Set<string>;
  onChoose: (outputIndex: number) => void;
}) {
  if (!state.choosing) return null;
  const found = (id: string) => known.has(id);
  // Engine orders options: this-run finds first in natural order,
  // never-seen outputs shuffled deterministically by state.rng (so
  // daily puzzles stay identical across players). The shuffle stops
  // players muscle-memorising "?-slot 2 is always wood".
  const indexed = state.choosing.options.map((r, i) => ({ r, i }));
  return (
    <div className="cbchoose" role="dialog" aria-label="Pick what to make">
      <div className="k">These make more than one thing. Pick one.</div>
      <div className="opts">
        {indexed.map(({ r, i }) => {
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

function ChainOverlay({ trace }: { trace: ChainTrace }) {
  // Measure cell geometry relative to the board. We re-measure once on
  // mount — the board doesn't resize mid-chain, so a single pass is
  // enough. Everything after that is pure CSS keyframes.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [geo, setGeo] = useState<{ w: number; h: number; centers: Map<number, { x: number; y: number }> } | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const board = svg.parentElement;
    if (!board) return;
    const br = board.getBoundingClientRect();
    const centers = new Map<number, { x: number; y: number }>();
    const cells = board.querySelectorAll<HTMLElement>("[data-cb]");
    cells.forEach((el) => {
      const idx = Number(el.getAttribute("data-cb"));
      if (!Number.isFinite(idx)) return;
      const r = el.getBoundingClientRect();
      centers.set(idx, {
        x: r.left - br.left + r.width / 2,
        y: r.top - br.top + r.height / 2,
      });
    });
    setGeo({ w: br.width, h: br.height, centers });
  }, [trace]);

  if (!geo) {
    return (
      <svg
        ref={svgRef}
        className="cbchainfx"
        aria-hidden="true"
      />
    );
  }

  const stroke = `var(--f${trace.tier})`;
  return (
    <svg
      ref={svgRef}
      className="cbchainfx"
      viewBox={`0 0 ${geo.w} ${geo.h}`}
      width={geo.w}
      height={geo.h}
      aria-hidden="true"
    >
      {trace.steps.map((step, si) => {
        const to = geo.centers.get(step.to);
        if (!to) return null;
        return (
          <g key={si}>
            {step.from.map((fromCell, fi) => {
              const from = geo.centers.get(fromCell);
              if (!from) return null;
              // Curved path — midpoint pulled toward the output and
              // offset perpendicular so parallel arcs don't overlap.
              const mx = (from.x + to.x) / 2;
              const my = (from.y + to.y) / 2;
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const len = Math.hypot(dx, dy) || 1;
              const nx = -dy / len;
              const ny = dx / len;
              const bend = 14 + fi * 6;
              const cx = mx + nx * bend;
              const cy = my + ny * bend;
              const d = `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
              return (
                <path
                  key={fi}
                  className="cbchain-arc"
                  d={d}
                  stroke={stroke}
                  style={{ animationDelay: `${step.drawAt}ms` } as React.CSSProperties}
                />
              );
            })}
            <circle
              className="cbchain-node"
              cx={to.x}
              cy={to.y}
              r={5}
              fill={stroke}
              style={{ animationDelay: `${step.drawAt + 150}ms` } as React.CSSProperties}
            />
          </g>
        );
      })}
    </svg>
  );
}

function fillVar(item: CombineItem): React.CSSProperties {
  // Pastel tier fill, with --pk left as the global ink colour — matches the
  // prototype's `icon()` which only sets --fill. Borders and drop shadows
  // on .cbc.full / .cbp are already keyed to --pk through the stylesheet.
  return { "--fill": `var(--f${item.tier})` } as React.CSSProperties;
}


function GlyphDrag() {
  return (
    <span className="mc" aria-hidden="true">
      <span className="bd">
        <span className="cl" />
        <span className="cl tgt anim-target" />
        <span className="cl full" />
        <span className="cl" />
      </span>
      <span className="tr">
        <span className="mt sm M anim-fly">
          <span className="d" />
        </span>
        <span className="mt sm P">
          <span className="d" />
        </span>
        <span className="mt sm S">
          <span className="d" />
        </span>
      </span>
    </span>
  );
}

function GlyphCombine() {
  return (
    <span className="mc" aria-hidden="true">
      <span className="bd">
        <span className="cl full anim-fuse" />
        <span className="cl full anim-fuse" style={{ animationDelay: ".2s" }} />
        <span className="cl" />
        <span className="cl" />
      </span>
      <span className="tr">
        <span className="mt sm C anim-rise">
          <span className="d" />
        </span>
      </span>
    </span>
  );
}

function GlyphShelf() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "flex",
        gap: 5,
        padding: "0 6px 5px",
        borderBottom: "2px solid var(--ink)",
        alignItems: "flex-end",
      }}
    >
      <span className="mt sm M anim-rise">
        <span className="d" />
      </span>
      <span className="mt md P anim-rise" style={{ animationDelay: ".25s" }}>
        <span className="d" />
      </span>
      <span className="mt sm S anim-rise" style={{ animationDelay: ".5s" }}>
        <span className="d" />
      </span>
    </span>
  );
}

function GlyphGlow() {
  return (
    <span className="mc" aria-hidden="true">
      <span className="bd">
        <span className="cl full anim-glow" />
        <span className="cl" />
        <span className="cl" />
        <span className="cl full anim-glow" style={{ animationDelay: ".7s" }} />
      </span>
    </span>
  );
}

function GlyphCrumble() {
  return (
    <span className="mc" aria-hidden="true">
      <span className="bd">
        <span className="cl full anim-crumble">
          <span className="crk anim-tick">3</span>
        </span>
        <span className="cl" />
        <span className="cl" />
        <span className="cl full" />
      </span>
    </span>
  );
}

function GlyphAges() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 58,
        height: 12,
        border: "1.5px solid var(--ink)",
        borderRadius: 2,
        background: "var(--surface)",
        overflow: "hidden",
        boxShadow: "1.5px 1.5px 0 var(--ink)",
        position: "relative",
      }}
    >
      <i
        className="anim-fill"
        style={{
          display: "block",
          height: "100%",
          width: "20%",
          background: "var(--accent)",
        }}
      />
    </span>
  );
}
