# Made Of

Made Of is a web app that shows what anything is made of, traced all the way back to the big bang, with sourced evidence for every link. It has four modes:

- **Daily link** puzzle (`/link`)
- **Explore** — bowtie view at `/i/[slug]` and `/explore/[slug]`
- **From scratch** / Craft (`/craft`)
- **Combine** (`/combine`), a tile-combining mode

### Combine, in short

- Combine is a **high-score game first**. Each run has a score; `account/stats` leaderboards and the Combine total/best are what players care about. The item collection and discovery badges are a progression aid along the way, not the goal.
- Combine has multiple themes (Everything and Everyday today, more later) plus a daily puzzle under the same board. All endless themes share one lifetime collection; the daily puzzle has **its own** collection so endless grinding can't walk a daily into pre-unlocked items. Scope lives on `combine_discoveries.scope` (`endless` | `daily`); existing rows were backfilled to `endless`.
- Finished-run records go to `progress` with `kind='combine'`, `ref=<theme>`, and `result.daily=<day key>` for daily runs. Future daily leaderboards filter on `result.daily`.
- **Theme membership is in Postgres** (`combine_themes` + `item_combine_themes`). Admins curate it from `/admin/combine/themes`. The `combine-exclude` tag still trumps membership as a safety net.
- **Progression is chapter-based** (log-scaled thresholds against cumulative unique discoveries) with a reachability-driven dealer (tiles unlock as the player discovers their partners), dealer temperature (discovered tiles down-weighted 0.2× so fresh tiles get airtime), and occupancy-scaled crumble (idle tiles die faster as the board fills). See `docs/PROGRESSION.html` for the spec.

## Current state

- The app is built. The prototype port is done and the HTML reference file was removed; **the DB is authoritative** for all content, with `src/data/*.data.ts` seeding fresh databases.
- Admin surfaces at `/admin`:
  - `/admin/tree` — hierarchical disclosure list of all items with inline CRUD on links, recipes, and items; filters, flat view, bulk edit.
  - `/admin/kinds` — manage the vocabulary of what an item *is*.
  - `/admin/combine/themes` — manage Combine themes with a reachability validator.
  - `/admin/items/[id]` — dedicated per-item editor (full form) still available alongside the modal.
- `docs/IMPLEMENTATION.md` is historical: it was the original build plan. Treat it as context, not as a to-do list.

## READ FIRST: How to handle requests

**Route every repo-changing request through the pm store.** Before you touch code for a user request that edits, refactors, adds a mode/admin surface/puzzle, changes docs, or modifies the schema:

1. `add_task` (assignee=claude).
2. `update_task` → `in_progress`.
3. **`add_comment` with the approach** — what files/routes/tables you plan to touch, key decisions, tradeoffs.
4. Do the work.
5. **`add_comment` with the landing summary** — what actually changed (files:lines), notable follow-ups, any tests skipped/blocked.
6. `update_task` → `done` + `append_changelog` (if user-visible or a decision).

Comments are load-bearing, not optional. A status flip + one-line changelog does not carry enough context — future work reads the task record. File the task from the first message of the request; do not start work and file retroactively.

- **Exempt:** pure Q&A, reads, explanations, or one-off investigation with no repo change.
- **"Just add it" escape:** if the user says "just add it", "file it", "log it", "don't work on it yet" (or similar), only create the task and stop.
- **Workflow reference:** `pm/ways_of_working.md` (status conventions, `assignee=claude`, MCP restart, review-tracking).
- **Don't clear `needs_review`.** `add_comment` and `status=done` auto-flag it — that's the user's inbox signal. Only the user clears it.

## How to work

- Match the app's existing look, copy, and interactions when adding features; don't redesign without reason.
- Write tests for graph functions (neighbours, path, everything-it-takes, recipe switching, daily moves) before porting UI, using cases the tests already cover.
- Ask before adding a paid service, or before changing pricing, privacy behaviour, or what is publicly visible.

## Hard rules

- **Never send the whole graph to the browser.** Each response holds at most one item's neighbourhood. `/api/items/:id/everything` is the only exception, and it is paid only.
- **Daily answers stay on the server.** Every move is checked server-side; the answer path is never sent to the client.
- **Entitlements are enforced on the server.** The UI only hides what the server already blocks.
- **Only `status = live` content is public.** Canary links (`is_canary`) appear only in API responses, never on item pages, the sitemap or `llms.txt`.
- **No child data.** No child profiles in Phase 1. Never enable session replay or set person properties on any future child profile.
- **Analytics go through the typed `track()` helper.** Identify users by their Better Auth user id only, never email or name.
- **Crawlers:** allow search engines and AI search or citation crawlers on item pages; block AI training crawlers; block `/api/` and `/admin/` for all.
- **Bump `ENGINE_VERSION` on any scoring-affecting Combine reducer change.** The constant lives in `src/combine/engine.ts`; server runs are stamped with it and replay rejects mismatches. Pure refactors that leave reducer output byte-identical don't need a bump — anything that changes scoring, dealer bias, recipe resolution, or state transitions does. Forgetting this lets a deploy silently re-score in-flight runs.

## Content model

| Entity | Table | Notes |
| --- | --- | --- |
| Item | `items` | `tier` (F N M C P S), `kind` → `kinds.code`, status (`draft` / `review` / `live`), `tags[]`, `isCanary` |
| Kind | `kinds` | Admin-managed. Was a Postgres enum; see migration `0009`. |
| Recipe | `recipes` | An item can have multiple recipes; recipe-scoped links hang off these. |
| Link | `links` | Types: `f` made-from, `w` made-with, `n` needs, `s` comes-from, `e` evolved-from. Confidence: `established` / `strong` / `debated` / `hypothesis`. Exactly one of `recipeId` / `itemId` is set. |
| Combine theme | `combine_themes` + `item_combine_themes` | Admin-managed sets of playable items. |
| Discovery | `combine_discoveries` | Lifetime collection scoped `endless` or `daily`. |

Link types in the current data (counts correct at seed, drift as admins edit):

| Type | Meaning (up / down) |
| --- | --- |
| `f` | Made from / Goes into |
| `w` | Made with / Used to make |
| `n` | Needs / Needed by |
| `s` | Comes from / Source of |
| `e` | Evolved from / Evolved into |

Recipe-scoped: `f`, `w`, `e` (and `n` optionally). Item-level: `n`, `s`. The UI enforces this split; the schema doesn't.

## Target stack

One Next.js service (App Router, TypeScript), built as a standalone server from a Dockerfile and deployed on Railway. Beside it in the same Railway project: Railway Postgres and a private Railway Storage Bucket. Cloudflare sits in front for caching, bot protection and an origin lock. In the app: Drizzle ORM, Better Auth (users and sessions in Postgres), an in-memory rate limiter and an in-process job scheduler. External APIs: Stripe, PostHog, Resend and Buffer. Remotion videos render outside the web service. There is no Supabase, Upstash or Vercel. Details are in `docs/IMPLEMENTATION.md`.

- **No volume on the web service.** All state lives in Postgres or the bucket, so deploys have no downtime and replicas stay possible.
- **Single instance for now.** The graph snapshot and rate-limit counters live in memory. If you add replicas, move the counters to Postgres and reload snapshots through `LISTEN/NOTIFY`.
- **Scheduled jobs take a Postgres advisory lock** before running, so a job never runs twice.
- **Trust only Cloudflare.** Reject requests missing the origin-lock header, and read the client IP from `CF-Connecting-IP`.
- **`NEXT_PUBLIC_*` used in client components must be declared as `ARG` + `ENV` in the Dockerfile build stage.** Next.js inlines these at build time; Railway service vars alone only reach runtime. Server Components read `process.env` at runtime, so they're fine without the ARG.

## Design

The design system's `:root` CSS variables (light and dark themes) live in `src/app/globals.css`. Fonts are Chivo and Chivo Mono. Pictograms are 32×32 SVG paths in `src/pictograms`, drawn on tier-coloured tiles with ink borders.

## Commands

Node 22, npm. All run from the repo root.

- `npm install` — install deps
- `npm run dev` — Next.js dev server on http://localhost:3000
- `npm run build` — production build (standalone)
- `npm run start` — run the production build
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — Next's ESLint config
- `npm test` — vitest run (parser + graph + validator tests, no DB needed)
- `npm run db:generate` — regenerate Drizzle migrations from `src/db/schema.ts`
- `npm run db:migrate` — apply migrations to `DATABASE_URL`
- `npm run db:seed` — load `src/data/*.data.ts` into the DB (idempotent on a fresh DB; destructive otherwise)
- `npm run db:studio` — open Drizzle Studio

Service and account setup (Railway, Cloudflare, Stripe, PostHog, etc.) lives in `docs/SERVICES.md`.
