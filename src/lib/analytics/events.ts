// Typed event taxonomy. Extend the discriminated union as events come online.
// Keep property names stable — PostHog can't rename after ingest.
//
// Call sites use `track()` (see ./track.ts); never call `posthog.capture()`
// directly. That keeps the schema one place and the guardrails enforceable.

export type AnalyticsEvent = never; // events get added here as we wire them
