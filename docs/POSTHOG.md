# PostHog

How Made Of uses PostHog for product analytics. Scope: what to turn on, what events to capture, what to keep out of PostHog and in Postgres instead.

## Guardrails (from CLAUDE.md)

- **No session replay.** Set `disable_session_recording: true` globally. Non-negotiable — ties to the "no child data" rule.
- **Identified-only person profiles.** `person_profiles: 'identified_only'`. Anonymous visitors generate events but no profile.
- **Identify by Better Auth user id only.** Never email, name, or any PII.
- **All analytics go through the typed `track()` helper.** No raw `posthog.capture()` at call sites.

## Setup checklist

Status as of T-0129 / C-0066. All foundation steps landed; see `src/lib/analytics/*` and `src/components/analytics/PostHogProvider.tsx`.

1. [x] Project API key (`phc_...`) and host (US region) → `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` in `.env.local` **and** on Railway `made-of` / production. `NEXT_PUBLIC_*` vars are inlined at build time, so changes require a redeploy.
2. [x] `posthog-js` + `posthog-node` installed.
3. [x] Next.js rewrite `/ingest/*` → PostHog host in `next.config.ts` (plus `/ingest/static/*` → `us-assets.i.posthog.com`). Dodges ad-blockers and keeps the host out of the client bundle.
4. [x] `PostHogProvider` mounted in `src/app/layout.tsx` under `<Suspense>` (required because `useSearchParams` for pageview bridge). Guardrails enforced in `src/lib/analytics/client.ts`.
5. [x] Server singleton at `src/lib/analytics/server.ts` (`captureServer()` tags events with `environment`). `server-only` import to prevent client bleed.
6. [~] Typed `track()` helper in `src/lib/analytics/track.ts` + `AnalyticsEvent` union in `src/lib/analytics/events.ts`. The union is `never` today — extend it as events come online (see "Pending entry points" + taxonomy below). Stub body uses `as` cast; once branches exist the generic narrows.
7. [x] Identify on Better Auth session via `PostHogProvider` — uses `session.user.id` only (no email/name). Resets on sign-out.

**Also wired, not in the original checklist:**

- `$pageview` captured on `pathname` + `searchParams` change (Next.js App Router doesn't fire autocapture pageviews on client nav).
- **`environment` super-property** on every event: `production | preview | development`, derived from `NODE_ENV` + `RAILWAY_ENVIRONMENT_NAME` (see `src/lib/analytics/env.ts`). One PostHog project hosts all envs — filter by `environment` on insights.
- Web Vitals autocapture left **on** for now (low traffic). Revisit near launch: ~5 extra events/pageview, ~5× the cost on volume. Filter out of Activity feed if noisy.

## Features to use

**Core**

- **Product Analytics / Events** — foundation; everything else is built on captured events.
- **Autocapture** — on initially for pageviews + clicks. Narrow once custom events cover the important paths.
- **Trends** — DAU/WAU/MAU, event counts, breakdowns by mode.
- **Funnels** — landing → first item view → first Combine run → run finished → return next day.
- **Retention** — cohort grids. Set "returned" to a meaningful event (`combine_run_started`, `item_viewed`), not `$pageview`.
- **Paths** — Sankey of what people do after landing or finishing a run. Useful for cross-mode discovery.

**For "what features do they use"**

- **Dashboards** — one per mode (Combine, Daily link, Explore, Craft) + a top-level Engagement dashboard.
- **Cohorts** — "Combine daily players," "Explore-only," "signed up but never played." Slice every insight by cohort.
- **Lifecycle** — splits DAU into new / returning / resurrecting / dormant.
- **Stickiness** — days-per-week an action happens. Tells you if Combine is a daily habit.

**Later**

- **Feature flags + Experiments** — A/B tests on identified users; also kill-switches for risky changes.
- **Surveys** — in-app NPS or churn-reason prompts to specific cohorts.
- **Web Analytics** — lighter marketing view (sources, bounce) alongside Product Analytics.

**Explicitly off**

- Session Replay.
- Person profiles for anonymous users.
- Heatmaps / Toolbar in production for logged-out users (dev-only is fine).

## Event taxonomy (sketch)

Reconcile with the launch doc's event list before freezing the `track()` union.

- **Navigation:** `item_viewed { slug, mode }`, `mode_switched`
- **Daily link:** `link_puzzle_started`, `link_move_made { correct }`, `link_puzzle_completed { moves, duration }`
- **Combine:** `combine_run_started { theme, scope, runId }`, `combine_merge { aId, bId, resultId, tier, runId, moveIndex }`, `combine_discovery { itemId, firstTime, runId }`, `combine_run_ended { score, duration, reason, runId }`
- **Craft:** `craft_recipe_tried`, `craft_item_made`
- **Account:** `signed_up`, `signed_in`, `paywall_shown { feature }`, `checkout_started`, `subscribed`
- **Reliability:** `error_boundary_triggered { route, digest, variant }` — variant is `page` | `region` | `global` | `combine_board`

## Pending entry points (waiting on event branches in `events.ts`)

`track()` exists — these call sites still log via `console.error` and need an `error_boundary_triggered` branch added to `AnalyticsEvent`, then a one-line swap each. Search for `"[error-boundary]"`, `"[global-error]"`, and `"[combine-board-error]"` to find them:

- `src/components/ErrorFallback.tsx` — fires on any route-segment `error.tsx` boundary. Has `variant` (`page` | `region`) and `error.digest` in scope.
- `src/app/global-error.tsx` — last-resort boundary when the root layout itself throws. Send `variant: "global"`.
- `src/components/combine/board-parts/board/BoardErrorBoundary.tsx` — client class boundary around the Combine board (in `componentDidCatch`). Send `variant: "combine_board"`, and include `componentStack` digest if available.

All three already match the event shape above; wiring is a one-line swap each.

## PostHog vs. Postgres — where tile/usage data lives

Three categories, three homes.

**1. Exploratory "how are people playing" → PostHog**

Fire `combine_merge` per merge. Answers:

- Which items get merged most? (Trends, breakdown by `resultId`)
- Which pairs are dead-end attempts? (filter failed merges, group by `aId+bId`)
- How many merges before first discovery? (Funnels)
- Do rare-item discoverers retain better? (Cohorts → Retention)
- Sankey of merges in a typical run (Paths)

Cheap, flexible, no schema changes. Right for the "I wonder if…" phase.

**Watch-outs:**

- Volume. 1k DAU × ~100 merges/run = 100k events/day from Combine alone. Free tier is 1M/month — blown in ~10 days. Stay on a paid tier, or sample (full fidelity for the first run per user per day, aggregate the rest).
- Send stable IDs, not admin-editable names.

**2. Product features that depend on usage → Postgres**

If tile-usage **drives the product** (leaderboards, "most-merged this week," balancing, admin curation), it belongs in Postgres. PostHog is BI, not a backend — never let a user-facing feature depend on it being up.

Natural extension of `combine_discoveries`: an aggregate like `combine_item_stats (itemId, theme, scope, mergesIn, mergesOut, lastSeenAt)` incremented in the same transaction as run completion. Build only when a feature needs it; don't pre-build.

**3. Not worth tracking at all**

- Per-tile hover/drag telemetry.
- Exact board positions over time.

## Decision rule

- "I'm curious" → PostHog.
- Powers a UI element users see → Postgres.

## The runId bridge

Generate a `runId` (uuid) client-side at Combine run start. Send it on every merge event, on `combine_run_ended`, and write it to `progress.result.runId`. That bridge between PostHog events and the Postgres run record is what makes cohorts like "players whose first run scored >X" possible later — trivial to add now, painful to backfill.
