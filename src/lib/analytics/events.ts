// Typed event taxonomy. Extend the discriminated union as events come online.
// Keep property names stable — PostHog can't rename after ingest.
//
// Call sites use `track()` (see ./track.ts); never call `posthog.capture()`
// directly. That keeps the schema one place and the guardrails enforceable.

/** Fired when a playtester toggles a Combine gameplay override via the
 *  in-game Experiments menu. Only emits when NEXT_PUBLIC_COMBINE_PLAYTEST=1,
 *  so prod cohort is empty by construction. */
export interface CombinePlaytestSet {
  name: "combine_playtest_set";
  properties: {
    /** Which override changed. */
    key: "mode" | "tray";
    /** Previous value (string for stability across type widening). */
    from: string;
    /** New value. */
    to: string;
  };
}

export type AnalyticsEvent = CombinePlaytestSet;
