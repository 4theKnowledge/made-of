"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  hasHelperMove,
  hasOrganicFinishingMove,
  newGame,
  reduce,
  WIPE_UNLOCK_CHAPTER,
} from "@/combine/engine";
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
  loadLastMode,
  loadSound,
  saveBest,
  saveDailyDone,
  saveGame,
  saveSound,
  loadNewUnlocks,
  addNewUnlocks,
  clearNewUnlock,
  type DailyResult,
  type MusicTrack,
  type SfxPack,
} from "@/combine/storage";
import { useCollection } from "@/combine/useCollection";
import { useCombineRun, type ReconcileEvent } from "@/combine/useCombineRun";
import { useReactions } from "@/combine/useReactions";
import {
  dailyShareQuery,
  dailyShareText,
  endlessShareText,
  fastShareText,
  resolveItemName,
  shareText,
} from "@/combine/share";
import type { Mode, ThemeBundle, ThemeKey } from "@/combine/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";
import { ButtonGroup } from "@/components/common/ButtonGroup";
import { HowToPlay } from "@/components/common/HowToPlay";
import { CombineDebugPanel } from "@/components/combine/CombineDebugPanel";
import {
  computeMastery,
  computePreview,
  type ChainTrace,
  type Fx,
  type MasteryInfo,
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
  AgePromoToast,
  AgeToast,
  DiscoveryToast,
  HintToast,
} from "@/components/combine/board-parts/toasts";
import {
  FeedbackSheet,
  type FeedbackPrefill,
} from "@/components/common/FeedbackSheet";
import { JourneySheet } from "@/components/combine/board-parts/overlays/JourneySheet";
import { ChoicePicker } from "@/components/combine/board-parts/overlays/ChoicePicker";
import { CollectionBook } from "@/components/combine/board-parts/overlays/CollectionBook";
import { DetailCard } from "@/components/combine/board-parts/overlays/DetailCard";
import { GameOverCard } from "@/components/combine/board-parts/overlays/GameOverCard";
import { DebugPanel } from "@/components/combine/board-parts/overlays/DebugPanel";
import { SoundMenu } from "@/components/combine/board-parts/overlays/SoundMenu";
import { ModeThemePicker } from "@/components/combine/board-parts/overlays/ModeThemePicker";
import { ChapterBar } from "@/components/combine/board-parts/board/ChapterBar";
import { Board } from "@/components/combine/board-parts/board/Board";
import { BoardErrorBoundary } from "@/components/combine/board-parts/board/BoardErrorBoundary";
import { DragGhost } from "@/components/combine/board-parts/board/DragGhost";
import { Hold } from "@/components/combine/board-parts/board/Hold";
import { Shelf } from "@/components/combine/board-parts/board/Shelf";
import { TipLine } from "@/components/combine/board-parts/board/TipLine";
import { TopBar } from "@/components/combine/board-parts/board/TopBar";
import { Tray } from "@/components/combine/board-parts/board/Tray";

interface Props {
  /** Endless/classic bundles keyed by theme code. Server ships only the
   *  bundles needed for the active render — usually the active theme plus
   *  the daily host (which may be the same). */
  bundles: Record<string, SerialisedBundle>;
  /** Fast-mode bundles (2-part recipes only, single band). Served alongside
   *  classic bundles so the same CombineBoard can swap modes without a
   *  round-trip. Fast runs are score-only — no collection unlocks. */
  fastBundles: Record<string, SerialisedBundle>;
  /** Daily-mode bundles. A theme without a dailyConfig serialises a bundle
   *  identical to its endless one; a theme with a config gets a bundle with
   *  capped ages, scaled ageNeed, and a guest-ingredient pool. */
  dailyBundles: Record<string, SerialisedBundle>;
  /** Today's daily discovery target, resolved from the day's payload.
   *  Null if no daily is scheduled or the row predates the target-list
   *  feature — in either case the engine falls back to the legacy
   *  age-progression end. */
  dailyTarget?: number | null;
  /** Today's daily RNG seed, frozen on the payload. Compared against a
   *  saved game's `initialSeed` so an admin reset-today mid-run drops the
   *  stale save and starts fresh. Null if no daily payload exists. */
  dailyPayloadSeed?: number | null;
  /** Feature flag — when false, hide every daily entry point (deep-link
   *  resolution, auto-open on first visit, theme-menu Daily option).
   *  Server-side gate runs `env flag OR isAdmin()` before passing. */
  dailyEnabled?: boolean;
  /** Server-provided admin flag. Only mounts the debug panel entry point.
   *  The reducer trusts the flag UI-side; real security is at the admin
   *  session check that produced this. */
  admin?: boolean;
  /** Is the current visitor signed in? Gates "suggest recipe" in the
   *  feedback sheet; the server still enforces, this just shapes the UI. */
  signedIn?: boolean;
  /** Active theme code — comes from ?t= on /combine. Defaults to the
   *  historical "everything" theme when unset. CombineBoard renders one
   *  theme at a time; switching themes reloads the page. */
  activeTheme?: string;
  /** Initial mode — comes from ?m= on /combine. Only "fast" is honoured;
   *  other values are ignored and the normal resume logic runs. Lets a
   *  theme-switch nav land directly in the right mode. */
  initialMode?: Mode;
  /** True when ?t= was present and resolved to a published theme. Signals
   *  that the player explicitly asked for this theme (via the theme-menu
   *  reload), so the mount-time resume logic must honour it and not
   *  hijack the board into a stale lastMode="daily"/"fast" slot. */
  themeFromUrl?: boolean;
  /** Theme hosting today's daily puzzle. May differ from `activeTheme` —
   *  daily is always the admin-configured host regardless of what the
   *  player picked for endless/fast. Defaults to "everything" so legacy
   *  behaviour is preserved when unset. */
  dailyHostTheme?: string;
  /** Themes available to the player in the mode+theme picker. Only
   *  published themes with at least one member are included. */
  publishedThemes?: Array<{
    code: string;
    label: string;
    description: string | null;
    pictogram: string | null;
  }>;
}

// Shared empty set for the DetailCard's `madeSignatures` prop so the common
// "no signatures recorded yet" case keeps a stable reference.
const EMPTY_SIG_SET: ReadonlySet<string> = new Set();

/** The top-level client component that owns engine state. */
export function CombineBoard({
  bundles: serialised,
  fastBundles: fastSerialised,
  dailyBundles: dailySerialised,
  dailyTarget = null,
  dailyPayloadSeed = null,
  dailyEnabled = true,
  admin = false,
  signedIn = false,
  activeTheme = "everything",
  initialMode,
  themeFromUrl = false,
  dailyHostTheme = "everything",
  publishedThemes = [],
}: Props) {
  const bundles = useMemo<Record<ThemeKey, ThemeBundle>>(() => {
    const out: Record<ThemeKey, ThemeBundle> = {};
    for (const [code, s] of Object.entries(serialised)) out[code] = hydrateBundle(s);
    return out;
  }, [serialised]);
  const fastBundles = useMemo<Record<ThemeKey, ThemeBundle>>(() => {
    const out: Record<ThemeKey, ThemeBundle> = {};
    for (const [code, s] of Object.entries(fastSerialised)) out[code] = hydrateBundle(s);
    return out;
  }, [fastSerialised]);
  const dailyBundles = useMemo<Record<ThemeKey, ThemeBundle>>(() => {
    const out: Record<ThemeKey, ThemeBundle> = {};
    for (const [code, s] of Object.entries(dailySerialised)) out[code] = hydrateBundle(s);
    return out;
  }, [dailySerialised]);
  /** Bundle a game should run against given its target theme/mode/daily key.
   *  Centralises the three-way pick so all call sites stay in sync. */
  const pickBundle = useCallback(
    (theme: ThemeKey, mode: Mode, daily: string | null): ThemeBundle => {
      if (mode === "fast") return fastBundles[theme];
      if (daily) return dailyBundles[theme];
      return bundles[theme];
    },
    [bundles, fastBundles, dailyBundles],
  );
  // The initial render must be deterministic across SSR and the first
  // client paint — read nothing that depends on window/localStorage here.
  // A deterministic 6×6 seed=42 game is used as the hydration target;
  // after mount we may replace it with a saved game or kick off a daily,
  // both of which happen in an effect below.
  const initial = useMemo(
    () => newGame(activeTheme, bundles[activeTheme], { seed: 42, size: 6 }).state,
    [activeTheme, bundles],
  );

  const [state, setState] = useState<GameState>(initial);
  // Active bundle follows mode + daily flag: fast uses the 2-part projection,
  // daily uses the (potentially capped) dailyBundles, endless uses the full
  // bundle. Daily and endless may be identical if the theme has no dailyConfig.
  const bundle = pickBundle(state.theme, state.mode, state.daily);
  // Collection is partitioned by scope: endless (both endless themes share
  // one bucket) vs. daily (its own bucket so daily puzzles are a fair start,
  // not fed by endless grinding). See useCollection for the full contract.
  const collectionScope = state.daily ? "daily" : "endless";
  const {
    collection,
    signatures: collectionSignatures,
    authed: collectionAuthed,
    isPending: collectionPending,
    record: recordDiscoveries,
  } = useCollection(collectionScope);
  // Server-authoritative run lifecycle. Opt-in via COMBINE_SERVER_RUNS;
  // when the flag is off, `serverBacked` stays false and every call is
  // a no-op (local reducer + localStorage remains source of truth).
  const run = useCombineRun();
  // Per-theme best scores + today's daily result. Loaded in an effect so
  // SSR/hydration stay deterministic. Fast mode keeps its own best record
  // so the two score curves don't contaminate each other.
  const [best, setBest] = useState<Record<ThemeKey, number>>({ [activeTheme]: 0 });
  const [fastBest, setFastBest] = useState<Record<ThemeKey, number>>({ [activeTheme]: 0 });
  const [dailyDone, setDailyDone] = useState<DailyResult | null>(null);
  // When a theme's numAges has grown since the player last saw it, surface
  // a one-time banner with the new age's label. Keyed by theme → label.
  const [newAgeBanner, setNewAgeBanner] = useState<Partial<Record<ThemeKey, string>>>({});


  // On mount: load best scores + today's daily result, and resume the
  // endless save if any (daily resume lives on the user's explicit tap
  // of the Daily button in ThemeMenu).
  //
  // When server runs are on, we wait for `run.ready` before deciding —
  // if the server has an active run for this slot, it wins over the
  // local path. When the flag is off, `run.ready` flips true with no
  // server context and we fall through to the localStorage flow.
  const didResume = useRef(false);
  useEffect(() => {
    if (didResume.current) return;
    if (!run.ready) return;
    didResume.current = true;
    setBest({ [activeTheme]: loadBest(activeTheme) });
    setFastBest({ [activeTheme]: loadBest(activeTheme, "fast") });
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
    // Gated by `dailyEnabled`: when the feature flag is off for this
    // viewer, we skip the deep-link resolution and fall through to the
    // endless path — shared daily share URLs just land on endless.
    const sp =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const deepLinkDay = sp?.get("d");
    if (dailyEnabled && deepLinkDay && deepLinkDay === todayKey()) {
      const day = deepLinkDay;
      const dailyBundle = dailyBundles[dailyHostTheme];
      const saved = loadGame(dailyBundle, { daily: day, expectedSeed: dailyPayloadSeed });
      setState(
        saved
          ? hydrateGame(saved, { target: dailyTarget })
          : newGame(dailyHostTheme, dailyBundle, {
              daily: day,
              size: 6,
              seed: dailySeed(day),
              target: dailyTarget,
            }).state,
      );
      return;
    }
    // Resume priority on plain /combine:
    //   1. If ?m=fast was set in the URL, prefer a fast run (resume save
    //      if any, else start fresh). Lets theme-switch nav land in fast.
    //   2. If ?t= resolved to a published theme (themeFromUrl), the player
    //      explicitly picked that theme in endless via the theme menu —
    //      resume its endless save or start fresh. Must beat the lastMode
    //      checks below so a stale daily/fast pointer can't hijack the
    //      user's selection.
    //   3. `lastMode` pointer (saveGame writes it on every tick) — hydrate
    //      whichever slot the player was actually in before the refresh.
    //      Prevents a stale fast save from hijacking a player who moved
    //      on to endless or daily.
    //   4. Fallback priority for first-ever visits / pre-pointer players:
    //      fast → endless → today's daily.
    //   5. Fall through to the deterministic fresh endless in `initial`.
    if (initialMode === "fast") {
      const fastSave = loadGame(fastBundles[activeTheme], { daily: null, mode: "fast" });
      if (fastSave) {
        setState(hydrateGame(fastSave));
      } else {
        setState(newGame(activeTheme, fastBundles[activeTheme], { mode: "fast", size: 6 }).state);
      }
      return;
    }
    const today = todayKey();
    if (themeFromUrl) {
      const endlessSave = loadGame(bundles[activeTheme], { daily: null });
      if (endlessSave && endlessSave.theme === activeTheme) {
        setState(hydrateGame(endlessSave));
      } else {
        setState(
          newGame(activeTheme, bundles[activeTheme], {
            seed: freshEndlessSeed(),
            size: 6,
          }).state,
        );
      }
      return;
    }
    const lastMode = loadLastMode();
    if (lastMode === "daily" && dailyEnabled && !loadDailyDone(today)) {
      const dailyBundle = dailyBundles[dailyHostTheme];
      const saved = loadGame(dailyBundle, { daily: today, expectedSeed: dailyPayloadSeed });
      if (saved) {
        setState(hydrateGame(saved, { target: dailyTarget }));
        return;
      }
    }
    if (lastMode === "fast") {
      const fastSave = loadGame(fastBundles[activeTheme], { daily: null, mode: "fast" });
      if (fastSave) {
        setState(hydrateGame(fastSave));
        return;
      }
    }
    if (lastMode === "endless") {
      const endlessSave = loadGame(bundles[activeTheme], { daily: null });
      if (endlessSave) {
        setState(hydrateGame(endlessSave));
        return;
      }
    }
    const fastSave = loadGame(fastBundles[activeTheme], { daily: null, mode: "fast" });
    if (fastSave) {
      setState(hydrateGame(fastSave));
      return;
    }
    const endlessSave = loadGame(bundles[activeTheme], { daily: null });
    if (endlessSave) {
      setState(hydrateGame(endlessSave));
      return;
    }
    if (dailyEnabled && !loadDailyDone(today)) {
      const dailyBundle = dailyBundles[dailyHostTheme];
      const saved = loadGame(dailyBundle, { daily: today, expectedSeed: dailyPayloadSeed });
      setState(
        saved
          ? hydrateGame(saved, { target: dailyTarget })
          : newGame(dailyHostTheme, dailyBundle, {
              daily: today,
              size: 6,
              seed: dailySeed(today),
              target: dailyTarget,
            }).state,
      );
    }
  }, [activeTheme, initialMode, themeFromUrl, dailyHostTheme, bundles, dailyBundles, fastBundles, dailyTarget, dailyPayloadSeed, dailyEnabled, run.ready]);

  // Server run alignment. Each time the local state settles on a fresh
  // (mode, theme, dailyKey) slot, register a matching server run. The
  // start endpoint is resume-by-default — if the server already has an
  // active run for the slot, we adopt its state; otherwise it mints a
  // new row. When the feature flag is off, start() returns null and
  // nothing changes. We intentionally use state.mode/theme/daily (not
  // the URL params) so a switchTheme / startFast call lines up with
  // the server slot it just moved to.
  //
  // Guard with didResume so we don't fire before the mount-time resume
  // has run; also skip over/fresh-initial states (seed=42) since those
  // aren't "the player's run" yet.
  const serverSlotRef = useRef<string>("");
  useEffect(() => {
    if (!didResume.current) return;
    if (state.over) return;
    // Deterministic SSR placeholder: don't register that.
    if (state.rng.rs === 42 && state.score === 0 && state.moves === 0) return;
    // Tutorial / other non-persisted modes don't register server runs —
    // the server route only accepts endless | fast | daily.
    if (state.mode !== "endless" && state.mode !== "fast" && state.mode !== "daily") return;
    const mode: "endless" | "fast" | "daily" = state.mode;
    const slot = `${mode}|${state.theme}|${state.daily ?? ""}`;
    if (serverSlotRef.current === slot) return;
    serverSlotRef.current = slot;
    void run.start({ mode, theme: state.theme, dailyKey: state.daily });
    // We don't adopt the server's returned state here — the local state
    // is already what the player sees, and start() returns the server's
    // view (which may be an empty resume on a fresh slot). If the server
    // has drift, /checkpoint returns 409 and the hook reconciles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode, state.theme, state.daily, state.over]);
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
    recipeId?: string;
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
  // Feedback sheet (summoned from "Report this recipe" on DiscoveryToast).
  const [feedback, setFeedback] = useState<FeedbackPrefill | null>(null);
  // Admin-only forced "last chance" state. Session-only; when true, the
  // dialog fires and the board border adopts its last-chance styling as if
  // the live predicate had flipped.
  const [previewLastChance, setPreviewLastChance] = useState(false);
  // The tile pressed and currently being held / dragged. Mirrors the
  // prototype's cbDrag record. Ghost x/y are in viewport coords.
  const [drag, setDrag] = useState<{
    slot: number;
    source: "tray" | "hold" | "board";
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
  // When the info card was opened by tapping a board tile (not a shelf /
  // tray / hold tile), carry the originating cell so we can expose a
  // "promote" affordance scoped to that cell. Null for non-board sources.
  const [infoCell, setInfoCell] = useState<number | null>(null);
  // Per-scope set of items the player unlocked recently and hasn't yet
  // acknowledged. Mirrors localStorage; survives reloads. Items leave
  // when the player opens their DetailCard or the Collection book.
  const [newUnlocks, setNewUnlocks] = useState<Set<string>>(() => new Set());
  const newUnlocksScopeRef = useRef<"endless" | "daily" | null>(null);

  // Hydrate the per-scope "new unlocks" badge set from localStorage when
  // the active scope changes (daily ↔ endless). Fast mode shares the
  // endless scope's state but can't add new entries (sfx skip below).
  useEffect(() => {
    if (newUnlocksScopeRef.current === collectionScope) return;
    newUnlocksScopeRef.current = collectionScope;
    setNewUnlocks(loadNewUnlocks(collectionScope));
  }, [collectionScope]);

  // Opening the DetailCard counts as "seeing" the item, so clear its
  // ★-new badge. Fast mode never adds badges, so the clear path is a
  // no-op there.
  useEffect(() => {
    if (!infoTile) return;
    if (!newUnlocks.has(infoTile)) return;
    const changed = clearNewUnlock(collectionScope, infoTile);
    if (!changed) return;
    setNewUnlocks((prev) => {
      if (!prev.has(infoTile)) return prev;
      const next = new Set(prev);
      next.delete(infoTile);
      return next;
    });
  }, [infoTile, newUnlocks, collectionScope]);
  const [themeOpen, setThemeOpen] = useState(false);
  // Sound settings. Loaded on mount from localStorage, then applied to the
  // live audio graph. SoundMenu dispatches updates up to the parent so the
  // audio context sees them without needing a bus.
  const [sound, setSound] = useState<{
    music: MusicTrack;
    sfxPack: SfxPack;
    vol: number;
  }>({ music: "piano", sfxPack: "classic", vol: 80 });
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
    else startMusic({ busyGetter: () => state.chapter });
  }, [sound, state.chapter]);

  // First pointerdown: create the audio context and start music if the
  // user has chosen a track. We attach a one-shot listener to the document.
  useEffect(() => {
    const onDown = () => {
      ensureContext({ ...sound, vol: sound.vol / 100 });
      if (sound.music !== "off") {
        startMusic({ busyGetter: () => state.chapter });
      }
    };
    document.addEventListener("pointerdown", onDown, {
      passive: true,
      once: true,
    });
    return () => document.removeEventListener("pointerdown", onDown);
    // We intentionally use the latest `sound` and `state.chapter` captured on
    // mount; the effect above handles later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause music when the tab is hidden, and silence it before the page is
  // torn down. Both paths fade the music bus first so already-scheduled
  // oscillators don't get cut off mid-cycle (which clicks on close).
  //
  // The pending-suspend timer lives in a ref so an effect re-run (triggered
  // by `sound` or `state.chapter` changing while the tab is hidden) can't
  // orphan it — otherwise the new onVis closure wouldn't cancel the
  // old setTimeout and the context would get re-suspended right after we
  // resume on return, leaving the scheduler ticking into silence.
  const suspendTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const clearSuspendTimer = () => {
      if (suspendTimerRef.current != null) {
        window.clearTimeout(suspendTimerRef.current);
        suspendTimerRef.current = null;
      }
    };
    const silence = () => {
      clearSuspendTimer();
      const fade = fadeOutMusic();
      const core = hasContext()
        ? ensureContext({ ...sound, vol: sound.vol / 100 })
        : null;
      if (!core) return;
      suspendTimerRef.current = window.setTimeout(() => {
        suspendAudio(core);
        suspendTimerRef.current = null;
      }, Math.ceil(fade * 1000) + 20);
    };
    const onVis = () => {
      if (document.hidden) {
        silence();
      } else if (sound.music !== "off" && hasContext()) {
        clearSuspendTimer();
        startMusic({ busyGetter: () => state.chapter });
      }
    };
    const onHide = () => silence();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }, [sound, state.chapter]);
  const [bookOpen, setBookOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [experimentsOpen, setExperimentsOpen] = useState(false);
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
        | { out: string; recipe: string[]; firstLifetime: boolean; recipeId?: string }
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

      // Immediate (non-combine) patch — placed/nope/crumble/discovery/chapter-up.
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
            recipeId: e.recipeId,
            firstLifetime,
          };
          discoveredOuts.add(e.out);
          // Separate sound grammar: age-find plays "discover", lifetime
          // unlock plays the louder "unlock" so the two moments feel
          // different even before the modal toast appears.
          window.setTimeout(
            () => playFx(firstLifetime ? "unlock" : "discover"),
            250,
          );
        } else if (e.type === "chapter-up") {
          latestAgeUp = { age: e.chapter, sample: e.sample, grants: e.grants };
          playFx("age");
          vibrate([15, 30, 15, 30, 30]);
        } else if (e.type === "over") {
          playFx("over");
        }
      }

      // Only surface the modal discovery toast for lifetime-new unlocks —
      // these are the long-tail-progression moments. Age discoveries
      // (first-this-run, already in lifetime collection) still fire the
      // per-cell sparkle via `fx.discover` and bump the shelf; the toast
      // was reading as a "new to your collection" moment to players even
      // when it was just "you made this again in this run".
      if (latestDiscovery && latestDiscovery.firstLifetime) {
        setDiscovery(latestDiscovery);
        const id = window.setTimeout(() => setDiscovery(null), 4600);
        timers.current.push(id);
        // Persist a ★-new badge for this item (cleared when the player
        // opens its DetailCard). Fast mode skips — its scope has no
        // lifetime collection.
        if (state.mode !== "fast") {
          const added = addNewUnlocks(collectionScope, [latestDiscovery.out]);
          if (added.length) {
            setNewUnlocks((prev) => {
              const next = new Set(prev);
              for (const id of added) next.add(id);
              return next;
            });
          }
        }
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
    [scheduleClear, collection, bundle.items, collectionScope, state.mode],
  );

  // Apply an action: run reduce once, update state, and route events.
  const act = useCallback(
    (action: Action) => {
      const r = reduce(state, bundle, action);
      setState(r.state);
      applyEvents(r.events);
      setSelectedSlot(null);
      // Mirror the action to the server if a run is active. The server
      // runs the same reducer on its side at checkpoint time and
      // validates the state matches. No-op when the feature is off.
      run.push(action);

      // If the game just ended, write best + daily done. Fast mode has its
      // own best bucket — see storage.saveBest.
      if (r.state.over && !state.over) {
        const isFast = r.state.mode === "fast";
        const prevBest = isFast
          ? fastBest[r.state.theme] ?? 0
          : best[r.state.theme] ?? 0;
        if (r.state.score > prevBest) {
          saveBest(r.state.theme, r.state.score, r.state.mode);
          if (isFast) {
            setFastBest((b) => ({ ...b, [r.state.theme]: r.state.score }));
          } else {
            setBest((b) => ({ ...b, [r.state.theme]: r.state.score }));
          }
          r.state.newBest = true;
        }
        // /finish writes the progress row server-side using the
        // replay-validated event log. Anon runs (no server-backed
        // context) just end locally — a signed-out player's best is
        // still kept in localStorage via the saveBest() call above.
        if (run.serverBacked) {
          void run.finish();
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
            age: r.state.chapter,
            ageName: bundle.theme.ages[r.state.chapter] ?? "",
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
      //
      // Fast mode is score-only — the engine suppresses `discovery` events,
      // but `combine` event inputs would still leak base ingredients into
      // the lifetime collection without this gate. Classic progression must
      // never be shortcutted by combo-dense fast runs.
      if (r.state.mode !== "fast") {
        // Two record kinds: `make` (combine event → tag with signature so
        // mastery can track which variant was used), and `unlock-only`
        // (base-ingredient leak from combine inputs → no signature, since
        // it's not a make). Discovery events alone don't carry inputs so
        // mastery rides exclusively on combine events; the output appears
        // in both discovery and combine events on the same make, so
        // mastering happens on the first time an output is made. Dedupe
        // the unlock-only ids to keep payloads tight.
        const records: Array<{ id: string; signature?: string }> = [];
        const unlockOnly = new Set<string>();
        for (const e of r.events) {
          if (e.type === "combine") {
            records.push({ id: e.out, signature: e.inputSignature });
            for (const id of e.inputs) {
              if (!bundle.outputs.has(id)) unlockOnly.add(id);
            }
          }
        }
        for (const id of unlockOnly) records.push({ id });
        if (records.length) recordDiscoveries(records);
      }
    },
    [state, bundle, applyEvents, best, fastBest, bundles, recordDiscoveries],
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
    setInfoCell(null);
    setSelectedSlot(null);
  }, []);

  // T-0181: register the reconcile callback once setState + the
  // transient-UI setters are in scope. Fires when the server returns
  // a 409 (drift, engine version mismatch, or run-ended). The server's
  // state is authoritative; we swap it in and clear any UI that
  // depended on the pre-reconcile reducer state (fx animations,
  // discovery toast, choose dialog). The run alignment effect below
  // picks up the fresh (mode, theme, daily) tuple and re-registers
  // with the server on the next tick.
  //
  // `setOnReconcile` is stable (useCallback-wrapped in the hook), but
  // `run` itself isn't — depend on the method directly to avoid
  // re-registering every render.
  const setOnReconcile = run.setOnReconcile;
  useEffect(() => {
    const onReconcile = (event: ReconcileEvent) => {
      if (event.state) {
        setState(event.state);
        resetTransient();
      }
      // For run-ended / run-invalidated the hook already dropped its
      // context; the slot-alignment effect will call run.start() again
      // the next time state settles, which is enough to resync.
    };
    setOnReconcile(onReconcile);
    return () => {
      setOnReconcile(null);
    };
  }, [setOnReconcile, resetTransient]);

  const switchTheme = useCallback(
    (which: ThemeKey) => {
      // If we're already playing this theme in endless, nothing to do.
      if (which === state.theme && state.mode === "endless") return;
      // Save the current game before swapping; try to resume the chosen
      // theme's endless save, otherwise start fresh. switchTheme always
      // lands on classic (switching themes implies leaving the fast
      // sprint); the fast slot is preserved by saveGame so refreshing
      // or coming back via startFast still finds it.
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
    (which: ThemeKey, nextMode: Mode) => {
      const nextBundle = nextMode === "fast" ? fastBundles[which] : bundles[which];
      setState(
        newGame(which, nextBundle, {
          mode: nextMode,
          seed: freshEndlessSeed(),
          size: 6,
        }).state,
      );
      resetTransient();
    },
    [bundles, fastBundles, resetTransient],
  );

  const startFast = useCallback(
    (which: ThemeKey) => {
      // Save the current game first so switching from classic → fast
      // doesn't lose the in-flight endless run (and vice versa — the new
      // fast run will overwrite its own slot on next state tick).
      saveGame(state);
      setState(
        newGame(which, fastBundles[which], {
          mode: "fast",
          seed: freshEndlessSeed(),
          size: 6,
        }).state,
      );
      resetTransient();
    },
    [state, fastBundles, resetTransient],
  );

  const startDaily = useCallback(() => {
    // Feature-flag guard: when daily is gated off for this viewer the
    // UI should never surface the entry point, but any stray callback
    // (stale onClick ref, keyboard shortcut) short-circuits here too.
    if (!dailyEnabled) return;
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
    const dailyBundle = dailyBundles[dailyHostTheme];
    const saved = loadGame(dailyBundle, { daily: day, expectedSeed: dailyPayloadSeed });
    if (saved) {
      saveGame(state);
      setState(hydrateGame(saved, { target: dailyTarget }));
    } else if (done) {
      // Done, but the final state is no longer in storage (older save or
      // storage got cleared). Nothing to resume into; keep the current
      // game as-is so the player doesn't accidentally start a replay.
      return;
    } else {
      saveGame(state);
      setState(
        newGame(dailyHostTheme, dailyBundle, {
          daily: day,
          size: 6,
          seed: dailySeed(day),
          target: dailyTarget,
        }).state,
      );
    }
    resetTransient();
  }, [bundles, dailyBundles, dailyHostTheme, state, resetTransient, dailyTarget, dailyPayloadSeed, dailyEnabled]);

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
      const resolved = resolveItemName(dr.top, bundles[dailyHostTheme] ?? bundles[activeTheme]);
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
    const dailyAgeCount = dailyBundles[dailyHostTheme].theme.ages.length;
    const text =
      `Made Of · Daily Combine ${dr.key}\n` +
      Array.from({ length: dailyAgeCount }, (_, k) =>
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
      ageCount: dailyAgeCount,
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
  }, [dailyDone, bundles, dailyBundles, activeTheme, dailyHostTheme]);

  const onCellTap = useCallback(
    (cell: number) => {
      // A trailing click from a completed board drag (move helper) must
      // not re-enter the tap paths below. endDrag sets this flag.
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      // In a finished run (e.g. reviewing today's completed daily), the
      // board is inert except for tapping a tile to open its info card.
      if (state.over) {
        const target = state.board[cell];
        if (target != null) {
          setInfoTile(target);
          setInfoCell(cell);
        }
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
      // Move mode: tap-to-select / tap-target in addition to drag. Mirrors
      // the tray's two-tap flow so touch users who don't drag can still use
      // the helper.
      //   - from == null, full cell  → select it
      //   - from == cell             → deselect (stay in mode)
      //   - from != null, any cell   → attempt move; engine rejects illegal
      //                                targets with a `nope` event. Stay in
      //                                mode on nope so the player can pick
      //                                another target; exit on success.
      //   - from == null, empty cell → exit mode (unchanged behavior)
      if (moveMode) {
        if (moveMode.from == null) {
          if (state.board[cell] == null) {
            setMoveMode(null);
            return;
          }
          setMoveMode({ from: cell });
          return;
        }
        if (moveMode.from === cell) {
          setMoveMode({ from: null });
          return;
        }
        const from = moveMode.from;
        const target = state.board[cell];
        const tile = state.board[from];
        if (tile == null) {
          setMoveMode(null);
          return;
        }
        const legal =
          target == null
            ? true
            : Boolean(matchOn(bundle, state.board, cell, tile, state.n));
        if (!legal) {
          // Keep the source selected so the player can try another cell.
          // The engine would emit `nope` if we dispatched; skip the trip.
          return;
        }
        act({ type: "move", from, to: cell });
        setMoveMode(null);
        return;
      }
      // No tray tile selected: a bare tap on a full board tile promotes
      // it (1-input recipes — star → supernova, etc.). Non-promotable
      // tiles are inert on tap; long-press opens the info card instead,
      // mirroring how the tray works (tap = act, long-press = inspect).
      if (selectedSlot == null) {
        const target = state.board[cell];
        if (target == null) return;
        const canPromote = (bundle.byIngredient.get(target) ?? []).some(
          (r) => r.all.length === 1 && r.all[0] === target,
        );
        if (canPromote) act({ type: "promote", cell });
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
      bundle,
      selectedSlot,
      state.board,
      state.crumb,
      state.hold,
      state.n,
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
      // Cancellable picker (promote) → back out and restore via snapshot.
      // Non-cancellable choosing stays modal.
      if (state.choosing?.cancellable) {
        act({ type: "cancel-choice" });
        return;
      }
      if (infoTile) {
        setInfoTile(null);
        setInfoCell(null);
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
        // First Escape drops the tap-selected source (if any); second
        // Escape exits the mode. Mirrors tray selection → mode exit.
        if (moveMode.from != null) setMoveMode({ from: null });
        else setMoveMode(null);
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
    act,
    state.choosing,
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
    source: "tray" | "hold" | "board";
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
    // Board-sourced drag = move helper. Drop on a valid destination fires
    // the `move` action; anything else is a snap-back (no state change).
    if (d.source === "board") {
      if (snapshot?.overCell != null && snapshot.overOk) {
        act({ type: "move", from: d.slot, to: snapshot.overCell });
      }
      setMoveMode(null);
      return;
    }
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
      const tile =
        d.source === "board"
          ? state.board[d.slot]
          : (d.source === "hold" ? state.hold : state.tray)[d.slot];
      if (tile == null) return { cell, ok: false, hold: false };
      // Board-sourced drag: the source cell is never a drop target.
      if (d.source === "board" && cell === d.slot) {
        return { cell, ok: false, hold: false };
      }
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
        if (d.source === "board") {
          // Promote: mark the source cell as moving so the Board styles it
          // like the tray's "selected" slot (dashed outline / lift).
          setMoveMode({ from: d.slot });
        } else {
          setSelectedSlot({ source: d.source, slot: d.slot });
        }
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

  // Board pointerdown handles two gestures:
  //
  //  - Move helper: arms a tentative drag; promotes to a real drag once
  //    the pointer moves past threshold (see useEffect pointermove at
  //    `d.moved`). A bare tap falls through to `onCellTap`, which handles
  //    tap-select / tap-target. Only armed when `moveMode.from == null`.
  //
  //  - Idle board (no helper mode, no tray selection): arms a 450ms
  //    long-press timer that opens the info card, mirroring the tray's
  //    "tap = act, long-press = inspect" grammar. The trailing click is
  //    suppressed so the promote in `onCellTap` doesn't also fire.
  const onCellPointerDown = useCallback(
    (cell: number, e: React.PointerEvent<HTMLButtonElement>) => {
      if (state.over) return;
      const tile = state.board[cell];
      if (tile == null) return;

      if (moveMode) {
        if (moveMode.from != null) return;
        const rect = e.currentTarget.getBoundingClientRect();
        suppressClick.current = false;
        dragRef.current = {
          slot: cell,
          source: "board",
          x0: e.clientX,
          y0: e.clientY,
          moved: false,
          tileWidth: rect.width,
          holdTimer: null,
          overCell: null,
          overHold: false,
        };
        setDrag({
          slot: cell,
          source: "board",
          x: e.clientX,
          y: e.clientY,
          tileWidth: rect.width,
          overCell: null,
          overOk: false,
          overHold: false,
        });
        return;
      }

      // Idle path: only arm long-press-for-info when nothing else is
      // claiming the tap. Any helper mode or an active tray selection
      // short-circuits above / via `onCellTap`.
      if (clearMode || shoreMode || pluckMode) return;
      if (selectedSlot != null) return;
      suppressClick.current = false;
      const x0 = e.clientX;
      const y0 = e.clientY;
      let armed = true;
      const cancel = () => {
        armed = false;
        if (timerId != null) window.clearTimeout(timerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cancel);
        window.removeEventListener("pointercancel", cancel);
      };
      const onMove = (ev: PointerEvent) => {
        if (!armed) return;
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 7) cancel();
      };
      const timerId = window.setTimeout(() => {
        if (!armed) return;
        armed = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cancel);
        window.removeEventListener("pointercancel", cancel);
        setInfoTile(tile);
        setInfoCell(cell);
        suppressClick.current = true;
      }, 450);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cancel);
      window.addEventListener("pointercancel", cancel);
    },
    [
      moveMode,
      clearMode,
      shoreMode,
      pluckMode,
      selectedSlot,
      state.board,
      state.over,
    ],
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
      age: state.chapter,
      found,
    });
  }, [
    bundle,
    state.chapter,
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
        if (state.chapter < WIPE_UNLOCK_CHAPTER || state.over) return;
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
      state.chapter,
      state.hold,
      state.board,
      state.undos,
      state.lastSnapshot,
      state.over,
      findHint,
    ],
  );

  const preview = useMemo(() => {
    // Move helper tap-select: once a board source is picked, feed it to the
    // preview so destinations light up like tray/hold selection does.
    if (moveMode && moveMode.from != null && !drag) {
      return computePreview(
        bundle,
        state,
        { source: "board", cell: moveMode.from },
        collection.keys(),
      );
    }
    return computePreview(bundle, state, selectedSlot, collection.keys());
  }, [bundle, state, selectedSlot, collection, moveMode, drag]);

  // Merged "known" set for UI affordances (preview glow, info card goes-into
  // list, choice picker ordering). Signed-in players carry their lifetime
  // collection in here; signed-out players only have this-game finds.
  const knownIds = useMemo(() => {
    const s = new Set<string>(state.found);
    for (const id of collection.keys()) s.add(id);
    return s;
  }, [state.found, collection]);

  // Reactions — subscribe to just the recipe/item ids the active overlays
  // need. Keeps the GET small per round-trip. The hook stabilises id lists
  // internally so passing fresh arrays each render is cheap.
  const reactionRecipeIds = useMemo(() => {
    const ids = new Set<string>();
    if (discovery?.recipeId) ids.add(discovery.recipeId);
    if (infoTile) {
      for (const r of bundle.recipes) {
        if (r.out === infoTile && r.id) ids.add(r.id);
      }
    }
    return [...ids];
  }, [discovery, infoTile, bundle.recipes]);
  const reactionItemIds = useMemo(
    () => (infoTile ? [infoTile] : []),
    [infoTile],
  );
  const {
    recipeReactions,
    itemReactions,
    authed: reactionsAuthed,
    vote: voteReaction,
  } = useReactions({
    recipeIds: reactionRecipeIds,
    itemIds: reactionItemIds,
  });

  // Per-item mastery for everything the player has made this run. Computed
  // against `knownIds` so the denominator only ever includes recipe variants
  // whose ingredients the player has already seen — admins adding a new
  // upstream variant can't retroactively drop a player's mastery count.
  // Fast mode has no collection or mastery; return an empty map so the
  // Shelf renders no mastery/progress badges.
  const mastery = useMemo(() => {
    const m = new Map<string, MasteryInfo>();
    if (state.mode === "fast") return m;
    for (const id of state.found) {
      const made = collectionSignatures.get(id);
      m.set(id, computeMastery(bundle, id, knownIds, made ?? new Set()));
    }
    return m;
  }, [state.found, state.mode, bundle, knownIds, collectionSignatures]);

  // "Last chance": the board is full, no combine can be finished from
  // tray/holds, but a helper spend (mv/swap/clear/pluck/wipe) could still
  // produce one. A board with empty cells isn't a dead end — the player can
  // keep placing tiles — so we gate on full-board here.
  const lastChanceLive = useMemo(() => {
    if (state.over) return false;
    const boardFull = state.board.every((v) => v != null);
    if (!boardFull) return false;
    if (hasOrganicFinishingMove(state, bundle)) return false;
    return hasHelperMove(state, bundle);
  }, [state, bundle]);
  // Admin preview overrides the live state, so the toggle demos the full
  // end-to-end experience (dialog + board styling) regardless of position.
  const lastChance = lastChanceLive || (admin && previewLastChance);

  // Fire the dialog on every transition into `lastChance`. Edge-triggered:
  // we only open on the false → true flip, so leaving and re-entering the
  // state (e.g. swap into a new dead end) gives a fresh alert.
  const [lastChanceOpen, setLastChanceOpen] = useState(false);
  const prevLastChanceRef = useRef(false);
  useEffect(() => {
    if (lastChance && !prevLastChanceRef.current) setLastChanceOpen(true);
    prevLastChanceRef.current = lastChance;
  }, [lastChance]);

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
      <div id="cb" className={state.over ? "cbdone" : undefined}>
        <TopBar
          state={state}
          fx={fx}
          best={
            (state.mode === "fast" ? fastBest : best)[state.theme] ?? 0
          }
          helpersOpen={helpersOpen}
          clearMode={clearMode}
          moveMode={moveMode != null}
          shoreMode={shoreMode}
          pluckMode={pluckMode}
          soundOn={sound.music !== "off" || sound.sfxPack !== "off"}
          signedIn={signedIn}
          isAdmin={admin}
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
          onDebug={() => {
            setMoreOpen(false);
            setExperimentsOpen(true);
          }}
          onHelp={() => {
            setMoreOpen(false);
            setHelpOpen(true);
          }}
          onIntro={() => {
            setMoreOpen(false);
            setOnboardOpen(true);
          }}
          onFeedback={() => {
            setMoreOpen(false);
            setFeedback({ type: "suggest_item", payload: {} });
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
        <ChapterBar
          state={state}
          bundle={bundle}
          onAges={() => setAgesOpen(true)}
        />
        <Shelf
          state={state}
          bundle={bundle}
          fx={fx}
          newUnlocks={newUnlocks}
          onInfo={(id) => setInfoTile(id)}
        />
        <BoardErrorBoundary>
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
            lastChance={lastChance}
            onCellTap={onCellTap}
            onCellPointerDown={onCellPointerDown}
          />
        </BoardErrorBoundary>
        {lastChance && !state.over && (
          <button
            type="button"
            className="cblastchance-finish"
            onClick={() => act({ type: "finish" })}
          >
            Finish now
          </button>
        )}
        <Hold
          state={state}
          bundle={bundle}
          active={Boolean(drag?.overHold)}
          activeOk={Boolean(drag?.overHold && drag.overOk)}
          dragging={Boolean(drag)}
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
            onCancel={() => act({ type: "cancel-choice" })}
          />
        )}
        {state.over && overCardOpen && (
          <GameOverCard
            state={state}
            bundle={bundle}
            collection={collection}
            best={
              (state.mode === "fast" ? fastBest : best)[state.theme] ?? 0
            }
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
                : state.mode === "fast"
                  ? fastShareText(state, bundle)
                  : endlessShareText(state, bundle);
              await shareText(text);
            }}
          />
        )}
        {state.over && !overCardOpen && !state.debug && (
          <div className="cbresultsrow">
            <ButtonGroup size="tight" align="start">
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
                    : state.mode === "fast"
                      ? fastShareText(state, bundle)
                      : endlessShareText(state, bundle);
                  await shareText(payload);
                }}
              >
                Share
              </button>
            </ButtonGroup>
          </div>
        )}
        {ageToast && (
          <AgeToast
            toast={ageToast}
            bundle={bundle}
            onDismiss={() => setAgeToast(null)}
          />
        )}
        {!ageToast && activeAgeBanner && (
          <AgePromoToast
            ageName={activeAgeBanner}
            onDismiss={dismissAgeBanner}
          />
        )}
        {discovery && (
          <DiscoveryToast
            discovery={discovery}
            bundle={bundle}
            onDismiss={() => setDiscovery(null)}
            reaction={
              discovery.recipeId
                ? recipeReactions.get(discovery.recipeId)
                : undefined
            }
            onReact={
              discovery.recipeId
                ? (value) => voteReaction("recipe", discovery.recipeId!, value)
                : undefined
            }
            authed={reactionsAuthed}
            onReport={() => {
              const inputs = discovery.recipe
                .map((id) => bundle.items.get(id)?.name)
                .filter((n): n is string => Boolean(n));
              const outItem = bundle.items.get(discovery.out);
              setFeedback({
                type: "report",
                payload: {
                  category: "recipe_wrong",
                  itemId: discovery.out,
                  recipeInputs: inputs,
                  ...(outItem ? { itemName: outItem.name } : {}),
                },
              });
              setDiscovery(null);
            }}
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
          <ModeThemePicker
            currentMode={state.mode}
            currentDaily={state.daily}
            currentTheme={state.theme}
            dailyEnabled={dailyEnabled}
            themes={publishedThemes}
            dailyDone={!!dailyDone}
            onShareDaily={shareDaily}
            onRestart={() => {
              setThemeOpen(false);
              restartTheme(state.theme, state.mode);
            }}
            onDismiss={() => setThemeOpen(false)}
            onConfirm={(nextMode, nextTheme) => {
              setThemeOpen(false);
              // Daily: always goes to the configured host theme; the board
              // already has the right bundle shipped.
              if (nextMode === "daily") {
                startDaily();
                return;
              }
              // Same theme? Switch mode in-place without a reload.
              if (nextTheme === activeTheme) {
                if (nextMode === "fast") startFast(nextTheme);
                else switchTheme(nextTheme);
                return;
              }
              // Theme changed — reload so the server builds the right
              // per-theme bundles. Preserve mode via the URL.
              const sp = new URLSearchParams();
              sp.set("t", nextTheme);
              if (nextMode === "fast") sp.set("m", "fast");
              window.location.href = `/combine?${sp.toString()}`;
            }}
          />
        )}
        {bookOpen && (
          <CollectionBook
            bundle={bundle}
            state={state}
            collection={collection}
            signatures={collectionSignatures}
            newUnlocks={newUnlocks}
            authed={collectionAuthed}
            authPending={collectionPending}
            onInfo={(id) => setInfoTile(id)}
            onAcknowledge={(id) => {
              if (!newUnlocks.has(id)) return;
              const changed = clearNewUnlock(collectionScope, id);
              if (!changed) return;
              setNewUnlocks((prev) => {
                if (!prev.has(id)) return prev;
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            }}
            onDismiss={() => setBookOpen(false)}
          />
        )}
        {agesOpen && (
          <JourneySheet
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
            madeSignatures={collectionSignatures.get(infoTile) ?? EMPTY_SIG_SET}
            mastery={mastery.get(infoTile)}
            itemReactions={itemReactions}
            onVoteReaction={voteReaction}
            reactionsAuthed={reactionsAuthed}
            onDismiss={() => {
              setInfoTile(null);
              setInfoCell(null);
            }}
            onReport={() => {
              const id = infoTile;
              setInfoTile(null);
              setInfoCell(null);
              const it = bundle.items.get(id);
              setFeedback({
                type: "report",
                payload: {
                  category: "item_wrong",
                  itemId: id,
                  ...(it ? { recipeInputs: [it.name] } : {}),
                },
              });
            }}
            onReportRecipe={(ingredients) => {
              const id = infoTile;
              setInfoTile(null);
              setInfoCell(null);
              const it = bundle.items.get(id);
              const inputs = ingredients
                .map((pid) => bundle.items.get(pid)?.name)
                .filter((n): n is string => Boolean(n));
              setFeedback({
                type: "report",
                payload: {
                  category: "recipe_wrong",
                  itemId: id,
                  recipeInputs: inputs,
                  ...(it ? { itemName: it.name } : {}),
                },
              });
            }}
          />
        )}
        {soundOpen && (
          <SoundMenu
            value={sound}
            onChange={(next) => {
              setSound(next);
              saveSound(next);
              // Confirmation ping when SFX comes back on (off → anything).
              // Also fires when switching between packs mid-session so the
              // player hears the new voice immediately.
              const wasOff = sound.sfxPack === "off";
              const nowOn = next.sfxPack !== "off";
              const packChanged = sound.sfxPack !== next.sfxPack;
              if ((wasOff && nowOn) || (packChanged && nowOn)) playFx("place");
            }}
            onDismiss={() => setSoundOpen(false)}
          />
        )}
        {experimentsOpen && (
          <DebugPanel onDismiss={() => setExperimentsOpen(false)} />
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
        <FeedbackSheet
          open={feedback !== null}
          onDismiss={() => setFeedback(null)}
          initial={feedback ?? undefined}
          signedIn={signedIn}
        />
        <ResponsiveSheet
          open={lastChanceOpen}
          onDismiss={() => setLastChanceOpen(false)}
          ariaLabel="Last chance"
          className="cblastchance-sheet"
        >
          <h3 style={{ margin: "4px 0 0 0", fontSize: 18, color: "var(--bad)" }}>
            Last chance
          </h3>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
            No tray or hold tile can finish a combine from here. You can spend
            a helper — move, swap, clear, pluck, or wipe — to keep going, or
            finish now and bank your score.
          </p>
          <ButtonGroup>
            <button
              type="button"
              className="cbh"
              onClick={() => setLastChanceOpen(false)}
            >
              Keep playing
            </button>
            <button
              type="button"
              className="cbh"
              style={{
                background: "var(--bad)",
                borderColor: "var(--bad)",
                color: "var(--bg)",
              }}
              onClick={() => {
                setLastChanceOpen(false);
                act({ type: "finish" });
              }}
            >
              Finish now
            </button>
          </ButtonGroup>
        </ResponsiveSheet>
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
        (drag.source === "board"
          ? state.board
          : drag.source === "hold"
            ? state.hold
            : state.tray)[drag.slot] != null && (
          <DragGhost
            tileId={
              (drag.source === "board"
                ? state.board
                : drag.source === "hold"
                  ? state.hold
                  : state.tray)[drag.slot]!
            }
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
              previewLastChance={previewLastChance}
              onPreviewLastChanceToggle={() =>
                setPreviewLastChance((v) => !v)
              }
              lastChance={lastChance}
              gameOverOpen={state.over && overCardOpen}
              onShowGameOver={() => {
                if (!state.over) act({ type: "debug-toggle-over" });
                setOverCardOpen(true);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}


















