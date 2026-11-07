/**
 * Guided tutorial for Combine: a scripted deck + a tiny step FSM.
 *
 * The tutorial is a real playable run — same reducer, same board, same
 * scoring — with the dealer handing out a pre-chosen sequence of tiles so
 * the player encounters each mechanic in order. Steps advance on real
 * game events (first place, first combine, first chain, first crumble…).
 *
 * The run is purely local: it bypasses the server run endpoints, never
 * persists to a save slot (see `saveGame` short-circuit on mode ===
 * "tutorial"), and never writes to the lifetime collection. On completion
 * we flip the per-user `hasSeenCombineTutorial` flag — anon players fall
 * back to a localStorage key.
 */

import type { GameState, Event } from "./engine";
import type { ThemeBundle } from "./types";

/** Scripted deck for the tutorial, expressed as slugs. Slugs are stable
 *  across DB reseeds; the ids in `bundle.items` are UUIDs that rotate on
 *  every reseed, so the deck must resolve at startup via
 *  `resolveTutorialDeck`.
 *
 *  Chosen: rock + water. Universally understood inputs. Multiple valid
 *  outputs (clay, soil, hot spring pool) means the ChoicePicker opens —
 *  which is intentional, because the picker is a real mechanic we need
 *  to teach anyway. The player gets to pick what they want to make. */
export const TUTORIAL_DECK_SLUGS: readonly string[] = [
  // First tray: rock + water → the player picks their first output.
  "rock",
  "water",
  "rock",
  // Second tray: water + rock → second combine, reinforcing the loop.
  "water",
  "rock",
  "water",
  // After that, the deck empties and the dealer falls back to normal
  // picks — the tutorial exits at that point too, so the player keeps
  // playing a real run instead of hanging in a scripted void.
];

/** Resolve the tutorial deck's slugs to bundle item ids. Returns an empty
 *  array when any slug can't be resolved — the caller should treat that
 *  as "tutorial not playable on this bundle" and fall back. */
export function resolveTutorialDeck(bundle: ThemeBundle): string[] {
  const bySlug = new Map<string, string>();
  for (const [id, item] of bundle.items) {
    bySlug.set(item.slug, id);
  }
  const out: string[] = [];
  for (const slug of TUTORIAL_DECK_SLUGS) {
    const id = bySlug.get(slug);
    if (!id) return [];
    out.push(id);
  }
  return out;
}

/** Tutorial step id. Advances in response to real game events. */
export type TutorialStepId =
  | "welcome"
  | "firstCombine"
  | "secondCombine"
  | "done";

/** Ordered list of step ids. Kept as the single source of truth so the
 *  overlay can reason about step progress numerically if needed. */
export const TUTORIAL_STEP_ORDER: readonly TutorialStepId[] = [
  "welcome",
  "firstCombine",
  "secondCombine",
  "done",
];

/** Index lookup for `TUTORIAL_STEP_ORDER`. */
export function tutorialStepIndex(id: TutorialStepId): number {
  return TUTORIAL_STEP_ORDER.indexOf(id);
}

/** Runtime context passed to dynamic tip templates. Lets step copy
 *  reference live game state — e.g. the output name from the player's
 *  most recent combine — so a recipe graph with multiple matching
 *  outputs (hydrogen + helium → star OR sun) doesn't produce a lying
 *  tip. */
export interface TutorialTipContext {
  /** The display name of the last output the player made this run, or
   *  null if no combine has happened yet. */
  lastOutName: string | null;
}

export interface TutorialStep {
  id: TutorialStepId;
  /** Short line shown in the overlay popover. May be a plain string or
   *  a function receiving live context — use the function form when the
   *  copy depends on what the player actually just did. */
  tip: string | ((ctx: TutorialTipContext) => string);
  /** Optional zone to visually emphasise. The overlay reads this and
   *  spotlights the matching `[data-tour=<zone>]` element. */
  highlight?: "tray" | "board" | "shelf" | "hold" | "chapter";
}

export const TUTORIAL_STEPS: Record<TutorialStepId, TutorialStep> = {
  welcome: {
    id: "welcome",
    tip: "Drag all three tray tiles onto the board. Place touching tiles to combine them.",
    highlight: "tray",
  },
  firstCombine: {
    id: "firstCombine",
    // Dynamic — rock + water has multiple outputs (clay, soil, hot spring
    // pool). The player picked one; the copy references what they made.
    tip: ({ lastOutName }) =>
      lastOutName
        ? `You made ${lastOutName}. Every combine scores and lands in your collection.`
        : "You made something new. Every combine scores and lands in your collection.",
    highlight: "chapter",
  },
  secondCombine: {
    id: "secondCombine",
    tip: "The dealer handed you more tiles. Combine them the same way — try making something new.",
    highlight: "tray",
  },
  done: {
    id: "done",
    tip: "You're playing a real run now. Have fun.",
  },
};

/** Resolve a step's tip to a plain string, applying the context when the
 *  tip is a function. Safe for both static and dynamic tips. */
export function resolveTip(step: TutorialStep, ctx: TutorialTipContext): string {
  return typeof step.tip === "function" ? step.tip(ctx) : step.tip;
}

/** Advance the tutorial step based on an event batch returned by the
 *  reducer. Pure — returns the next step id (which may be the same).
 *
 *  Each event is consumed by at most one transition, so a single batch
 *  can advance the FSM by at most one step per matching event. This
 *  prevents the "welcome → firstCombine → done" cascade on a single
 *  `dealt` event, which would skip firstCombine's copy entirely. */
export function nextStep(
  current: TutorialStepId,
  events: Event[],
  state: GameState,
): TutorialStepId {
  if (state.over) return "done";
  let step = current;
  for (const e of events) {
    // Each `dealt` event advances exactly one step. `dealt` fires every
    // time `afterMove` refills an empty tray, which is our observable
    // "the player emptied the tray" signal — we can't check
    // `state.tray.every(null)` because by the time nextStep runs, the
    // tray has already been re-dealt (see engine.ts:661).
    //
    // welcome → firstCombine: first tray emptied.
    if (step === "welcome" && e.type === "dealt") {
      step = "firstCombine";
      continue;
    }
    // firstCombine → secondCombine: second tray emptied. Nudges the
    // player to make another combine with the fresh tiles.
    if (step === "firstCombine" && e.type === "dealt") {
      step = "secondCombine";
      continue;
    }
    // secondCombine → done: third tray emptied. The player has the
    // full loop now (combine, score, re-deal, combine again). Overlay
    // closes.
    if (step === "secondCombine" && e.type === "dealt") {
      step = "done";
    }
  }
  return step;
}

/** Is the given bundle a plausible host for the tutorial? Checks every
 *  slug in `TUTORIAL_DECK_SLUGS` resolves to a bundle item. We no longer
 *  require a specific output ("star") to exist — step 3 copy is dynamic
 *  and reads the actual combine output, so any recipe that resolves from
 *  the scripted inputs will do. Called by CombineBoard before kicking
 *  off a tutorial run so we don't trap the player in a tutorial the
 *  data can't support. */
export function tutorialPlayableOn(bundle: ThemeBundle): boolean {
  const slugs = new Set<string>();
  for (const [, item] of bundle.items) slugs.add(item.slug);
  for (const slug of TUTORIAL_DECK_SLUGS) {
    if (!slugs.has(slug)) return false;
  }
  return true;
}

/** localStorage key for anon users' "seen tutorial" flag. Signed-in users
 *  use `authUser.hasSeenCombineTutorial` on the server. */
export const TUTORIAL_SEEN_KEY = "madeof:cbtut";

export function hasSeenTutorialLocal(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TUTORIAL_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTutorialSeenLocal(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
  } catch {
    // ignore
  }
}
