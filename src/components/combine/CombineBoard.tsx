"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { newGame, reduce, WIPE_UNLOCK_AGE } from "@/combine/engine";
import type { Action, Event, GameState } from "@/combine/engine";
import { matchOn } from "@/combine/match";
import { findHint as pureFindHint, type HintResult } from "@/combine/hint";
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
import type { ThemeBundle, ThemeKey } from "@/combine/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { HowToPlay } from "@/components/common/HowToPlay";
import { CombineDebugPanel } from "@/components/combine/CombineDebugPanel";
import {
  computePreview,
  type ChainTrace,
  type Fx,
} from "@/components/combine/board-parts/types";
import { vibrate } from "@/components/combine/board-parts/util";
import {
  GlyphAges,
  GlyphCombine,
  GlyphCrumble,
  GlyphDrag,
  GlyphGlow,
  GlyphShelf,
  OnboardingDemo,
} from "@/components/combine/board-parts/onboarding";
import {
  AgeToast,
  DiscoveryToast,
  HintToast,
} from "@/components/combine/board-parts/toasts";
import { AgesSheet } from "@/components/combine/board-parts/overlays/AgesSheet";
import { ChoicePicker } from "@/components/combine/board-parts/overlays/ChoicePicker";
import { CollectionBook } from "@/components/combine/board-parts/overlays/CollectionBook";
import { DetailCard } from "@/components/combine/board-parts/overlays/DetailCard";
import { GameOverCard } from "@/components/combine/board-parts/overlays/GameOverCard";
import { SoundMenu } from "@/components/combine/board-parts/overlays/SoundMenu";
import { ThemeMenu } from "@/components/combine/board-parts/overlays/ThemeMenu";
import { AgeBar } from "@/components/combine/board-parts/board/AgeBar";
import { Board } from "@/components/combine/board-parts/board/Board";
import { DragGhost } from "@/components/combine/board-parts/board/DragGhost";
import { Hold } from "@/components/combine/board-parts/board/Hold";
import { Shelf } from "@/components/combine/board-parts/board/Shelf";
import { TipLine } from "@/components/combine/board-parts/board/TipLine";
import { TopBar } from "@/components/combine/board-parts/board/TopBar";
import { Tray } from "@/components/combine/board-parts/board/Tray";

interface Props {
  bundles: {
    everything: SerialisedBundle;
  };
  /** Server-provided admin flag. Only mounts the debug panel entry point.
   *  The reducer trusts the flag UI-side; real security is at the admin
   *  session check that produced this. */
  admin?: boolean;
}

/** The top-level client component that owns engine state. */
export function CombineBoard({ bundles: serialised, admin = false }: Props) {
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
  // Pluck-mode: next tap on a board tile lifts it into hold.
  const [pluckMode, setPluckMode] = useState(false);
  // Wipe-board confirmation dialog.
  const [wipeConfirm, setWipeConfirm] = useState(false);
  // Hint toast — a card with a recipe to try when nothing fits.
  const [hintToast, setHintToast] = useState<HintResult | null>(null);
  const [fx, setFx] = useState<Fx>({});
  const [discovery, setDiscovery] = useState<{
    out: string;
    recipe: string[];
    firstLifetime: boolean;
  } | null>(null);
  const [ageToast, setAgeToast] = useState<{
    age: number;
    sample: string[];
    grants: { mv: number; swap: number; clear: number; hint: number; shore: number; pluck: number };
  } | null>(null);
  // Admin-only debug panel visibility. Only ever flipped from the FAB
  // button below the board, which itself only renders when the server
  // said this session is admin.
  const [debugOpen, setDebugOpen] = useState(false);
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
  // First-run onboarding: a non-interactive ghost-hand demo overlay shown
  // once per device. Replayable from the "..." menu. Separate from
  // HowToPlay which is the reference modal.
  const [onboardOpen, setOnboardOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!window.localStorage.getItem("madeof:cbonboarded")) {
        setOnboardOpen(true);
        window.localStorage.setItem("madeof:cbonboarded", "1");
      }
    } catch {
      // ignore — Safari private mode etc.
    }
  }, []);
  const [agesOpen, setAgesOpen] = useState(false);
  // Game-over summary card. Opens automatically when the run ends; the
  // player can dismiss it to review the final board (especially useful for
  // a finished daily they re-entered from the theme menu).
  const [overCardOpen, setOverCardOpen] = useState(false);
  const prevOverRef = useRef(false);
  useEffect(() => {
    if (state.over && !prevOverRef.current && !state.debug) {
      setOverCardOpen(true);
    }
    prevOverRef.current = state.over;
  }, [state.over, state.debug]);
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
      let latestAgeUp: {
        age: number;
        sample: string[];
        grants: { mv: number; swap: number; clear: number; hint: number; shore: number; pluck: number };
      } | null = null;

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
      // Index of combine event → its group. Every combine (even a solo
      // one) gets a group so the overlay can draw its arcs; the group's
      // length tells us whether to render the full-fat chain visuals or
      // the lighter solo variant.
      const eventGroup = new Map<number, Group>();
      for (const g of groups) {
        for (let i = g.startIdx; i <= g.endIdx; i++) eventGroup.set(i, g);
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
                solo: group.endIdx === group.startIdx,
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
            // + clear now that the trace is complete. Skip solo traces
            // where no ingredient cell differs from the output — e.g. a
            // 2-tile drop-on-top combines at a single cell, so there's
            // no meaningful arc to draw. Chains always render.
            if (eIdx === group.endIdx) {
              const hasSpatialArc = entry.trace.steps.some((s) =>
                s.from.some((c) => c !== s.to),
              );
              if (!entry.trace.solo || hasSpatialArc) {
                const finalPopEnd = popAt + POP_MS;
                const traceSnapshot: ChainTrace = {
                  steps: entry.trace.steps,
                  members: entry.trace.members,
                  tier: entry.trace.tier,
                  startedAt: entry.mountAt,
                  solo: entry.trace.solo,
                };
                schedule.push({
                  at: entry.mountAt,
                  patch: { trace: traceSnapshot },
                  clearAt: finalPopEnd + CHAIN_FADE_MS,
                  clearKeys: ["trace"],
                });
              }
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
          latestAgeUp = { age: e.age, sample: e.sample, grants: e.grants };
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
      // Pluck mode: tap a board tile to lift it into hold.
      if (pluckMode) {
        if (state.board[cell] == null) return;
        if (!state.hold.some((v) => v == null)) return;
        act({ type: "pluck-hold", cell });
        setPluckMode(false);
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
    [
      act,
      selectedSlot,
      state.board,
      state.crumb,
      state.hold,
      state.over,
      clearMode,
      moveMode,
      shoreMode,
      pluckMode,
    ],
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
      if (state.over) return;
      setSelectedSlot((s) =>
        s && s.source === source && s.slot === slot ? null : { source, slot },
      );
    },
    [state.over],
  );

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
      if (pluckMode) {
        setPluckMode(false);
        return;
      }
      if (wipeConfirm) {
        setWipeConfirm(false);
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
    pluckMode,
    wipeConfirm,
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
    if (state.over) return;
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
  }, [act, drag, state.board, state.over]);

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
      if (state.over) return;
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
    [state.hold, state.tray, state.over],
  );

  const onChoose = useCallback(
    (outputIndex: number) => {
      act({ type: "choose", outputIndex });
    },
    [act],
  );

  const findHint = useCallback((): HintResult | null => {
    const found = new Set(state.found);
    for (const id of collection.keys()) found.add(id);
    return pureFindHint(bundle, {
      board: state.board,
      size: state.n,
      tray: state.tray,
      hold: state.hold,
      age: state.age,
      found,
    });
  }, [
    bundle,
    state.age,
    state.n,
    state.board,
    state.tray,
    state.hold,
    state.found,
    collection,
  ]);

  const onHelper = useCallback(
    (
      which:
        | "hint"
        | "swap"
        | "clear"
        | "move"
        | "shore"
        | "pluck"
        | "wipe"
        | "undo",
    ) => {
      setHelpersOpen(false);
      // Undo rewinds the last placement/drop/move. Blocked by the
      // engine when the last turn produced a discovery (so daily
      // scope stays safe from unlock-then-undo gaming).
      if (which === "undo") {
        if (state.undos <= 0 || !state.lastSnapshot || state.over) return;
        setClearMode(false);
        setMoveMode(null);
        setShoreMode(false);
        setPluckMode(false);
        setSelectedSlot(null);
        act({ type: "undo" });
        return;
      }
      // Entering move/clear/shore/pluck cancels selection and any opposing
      // mode.
      if (which === "clear") {
        if (state.clears <= 0 || state.over) return;
        setMoveMode(null);
        setShoreMode(false);
        setPluckMode(false);
        setSelectedSlot(null);
        setClearMode((m) => !m);
        return;
      }
      if (which === "move") {
        if (state.mv <= 0 || state.over) return;
        setClearMode(false);
        setShoreMode(false);
        setPluckMode(false);
        setSelectedSlot(null);
        setMoveMode((m) => (m ? null : { from: null }));
        return;
      }
      if (which === "shore") {
        if (state.shore <= 0 || state.over) return;
        setClearMode(false);
        setMoveMode(null);
        setPluckMode(false);
        setSelectedSlot(null);
        setShoreMode((m) => !m);
        return;
      }
      if (which === "pluck") {
        if (state.pluck <= 0 || state.over) return;
        // No point entering pluck mode with no room to stash a tile or
        // nothing to lift.
        if (!state.hold.some((v) => v == null)) return;
        if (!state.board.some((v) => v != null)) return;
        setClearMode(false);
        setMoveMode(null);
        setShoreMode(false);
        setSelectedSlot(null);
        setPluckMode((m) => !m);
        return;
      }
      if (which === "wipe") {
        if (state.age < WIPE_UNLOCK_AGE || state.over) return;
        // Wipe is destructive — clears board, hold, and spends an age.
        // Confirm first so a stray tap can't drop a player back a tier.
        setClearMode(false);
        setMoveMode(null);
        setShoreMode(false);
        setPluckMode(false);
        setSelectedSlot(null);
        setWipeConfirm(true);
        return;
      }
      if (which === "swap") {
        if (state.swaps <= 0) return;
        setClearMode(false);
        setMoveMode(null);
        setShoreMode(false);
        setPluckMode(false);
        act({ type: "swap" });
        return;
      }
      if (which === "hint") {
        if (state.hints <= 0 || state.over) return;
        const h = findHint();
        if (!h) return;
        act({ type: "hint" });
        setHintToast(h);
      }
    },
    [
      act,
      state.clears,
      state.mv,
      state.swaps,
      state.hints,
      state.shore,
      state.pluck,
      state.age,
      state.hold,
      state.board,
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
      <div id="cb" className={state.over ? "cbdone" : undefined}>
        <TopBar
          state={state}
          fx={fx}
          best={best[state.theme] ?? 0}
          helpersOpen={helpersOpen}
          clearMode={clearMode}
          moveMode={moveMode != null}
          shoreMode={shoreMode}
          pluckMode={pluckMode}
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
            if (pluckMode) {
              setPluckMode(false);
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
          onIntro={() => {
            setMoreOpen(false);
            setOnboardOpen(true);
          }}
        />
        <TipLine
          state={state}
          hasSelection={selectedSlot != null}
          preview={preview}
          clearMode={clearMode}
          moveMode={moveMode}
          shoreMode={shoreMode}
          pluckMode={pluckMode}
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
          pluckMode={pluckMode}
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
        {state.over && !overCardOpen && !state.debug && (
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
        {infoTile && (
          <DetailCard
            tileId={infoTile}
            bundle={bundle}
            known={knownIds}
            howMade={state.howMade}
            onDismiss={() => setInfoTile(null)}
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
        {onboardOpen && (
          <OnboardingDemo onDismiss={() => setOnboardOpen(false)} />
        )}
        <ConfirmDialog
          open={wipeConfirm}
          title="Wipe the board?"
          body="Clears every tile on the board and in hold, and drops you back one age. Your score, discoveries and shelf stay. This can't be undone."
          confirmLabel="Wipe"
          cancelLabel="Keep playing"
          destructive
          onConfirm={() => {
            setWipeConfirm(false);
            act({ type: "wipe-board" });
          }}
          onDismiss={() => setWipeConfirm(false)}
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
            verdict={
              drag.overCell != null || drag.overHold
                ? drag.overOk
                  ? "ok"
                  : "bad"
                : null
            }
          />
        )}
      {admin && (
        <>
          <button
            type="button"
            className="cbdebug-fab"
            onClick={() => setDebugOpen((v) => !v)}
            aria-label={debugOpen ? "Close debug panel" : "Open debug panel"}
            aria-expanded={debugOpen}
          >
            debug
          </button>
          {debugOpen && (
            <CombineDebugPanel
              state={state}
              bundle={bundle}
              dispatch={act}
              onClose={() => setDebugOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}


















