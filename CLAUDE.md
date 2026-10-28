# Made Of

Made Of is a web app that shows what anything is made of, traced all the way back to the big bang, with sourced evidence for every link. It has three modes: the **Daily link** puzzle (the home page), **Explore** (the bowtie view of one item's inputs and outputs) and **From scratch** (a crafting game).

## Current state

- No app code yet and no commits. The next step is Phase 1 of the implementation guide.
- `Made Of.html` is the working prototype and the reference implementation: one 509 KB file with all data embedded. Its look, copy and behaviour are the spec.
- `docs/IMPLEMENTATION.md` is the build plan: stack, schema, API, routes and six phases with acceptance criteria. Read it before starting any phase.
- Living versions of the plans, which may be newer than the repo copy:
  - Implementation guide: https://claude.ai/artifact/La3k9ECzTyhbSg4vcaXanq
  - Launch plan (product, pricing, analytics events, SEO, privacy): https://claude.ai/artifact/F7AE2bMkbXRoi3ugkQqkod

## How to work

- One phase per branch, with a pull request at the end. Check the phase's acceptance criteria before starting the next.
- Port behaviour, don't redesign. Match the prototype's layout, copy and interactions.
- Write tests for the graph functions (neighbours, path, everything-it-takes, recipe switching, daily moves) before porting UI, using cases taken from the prototype.
- Ask before adding a paid service, or before changing pricing, privacy behaviour or what is publicly visible.
- Where the prototype and the guide disagree on data, the prototype wins (see Known discrepancies).

## Hard rules

- **Never send the whole graph to the browser.** Each response holds at most one item's neighbourhood. `/api/items/:id/everything` is the only exception, and it is paid only.
- **Daily answers stay on the server.** Every move is checked server-side; the answer path is never sent to the client.
- **Entitlements are enforced on the server.** The UI only hides what the server already blocks.
- **Only `status = live` content is public.** Canary links (`is_canary`) appear only in API responses, never on item pages, the sitemap or `llms.txt`.
- **No child data.** No child profiles in Phase 1. Never enable session replay or set person properties on any future child profile.
- **Analytics go through the typed `track()` helper.** Identify users by their Better Auth user id only, never email or name.
- **Crawlers:** allow search engines and AI search or citation crawlers on item pages; block AI training crawlers; block `/api/` and `/admin/` for all.

## Reading the prototype

The file contains one 262 KB line (the `EVIDENCE` JSON). Never read the whole file, and always truncate search output (for example `grep -n ... | cut -c1-200`). Line numbers below are approximate; search for the landmark text.

| What | Landmark | Around line |
| --- | --- | --- |
| Tiers, kinds, link types | `const TIERS`, `const KINDS`, `const REL` | 1096 |
| Item data (276 items) | `` const DATA = ` `` | 1118 to 1406 |
| Evidence (354 links, 413 sources) | `const EVIDENCE = /*EVIDENCE*/` | 1411 |
| Confidence levels | `const CONF` | 1412 |
| Parser and graph build | `function parseParts`, `items.set(` | 1425 |
| Graph helpers | `function ancestors`, `loopPath`, `bfsU`, `bfsOpen` | 1467 |
| Pictograms | `const PICTO={` | 1545 |
| Daily puzzle | `function makePuzzle`, `puzzleMove` | 2017 |
| From scratch | `function ready`, `newScratch`, `scratchMake` | 2125 |

### Data format

Each `DATA` line is `name|tier|kind|year|symbol|recipes|links|fact`.

- `name` is the item id: lowercase, may contain spaces (`big bang`). The URL slug comes from `slug(name)`.
- `tier` is one of `F N M C P S` (Fundamental, Natural, Material, Component, Product, System).
- `year` looks like `13.8bya`, `385mya`, `10ka`, `1994` or `-3500` (BCE). A `~` prefix means circa; `?` means unknown. `parseYear` hard-codes 2026 as "now"; use the current year when porting.
- `recipes` are alternatives separated by ` / `. Each may start with a `[label]` and holds `;`-separated parts of the form `type:a,b,c`. Recipes use the `f`, `w`, `n` and `e` link types.
- `links` holds item-level `n:` and `s:` parts.

Link types (from `REL`), with counts in the current data:

| Type | Meaning (up / down) | Count |
| --- | --- | --- |
| `f` | Made from / Goes into | 289 |
| `n` | Needs / Needed by | 101 |
| `w` | Made with / Used to make | 69 |
| `e` | Evolved from / Evolved into | 40 |
| `s` | Comes from / Source of | 27 |

`EVIDENCE.links[].ids` use the form `child<type<parent`, for example `RNA<f<nucleotides`. Confidence levels are `established`, `strong`, `debated` and `hypothesis`.

### Known discrepancies

`docs/IMPLEMENTATION.md` predates a close read of the prototype. Follow the prototype:

- The `links.type` column needs all five types, including `w` (made with), not four.
- The lowest confidence level is `hypothesis`, not `weak`. The daily puzzle generator should reject `debated` and `hypothesis` links.
- The guide's migration step expects the prototype at `legacy/made-of.html`. Move `Made Of.html` there in Phase 1.

## Target stack

One Next.js service (App Router, TypeScript), built as a standalone server from a Dockerfile and deployed on Railway. Beside it in the same Railway project: Railway Postgres and a private Railway Storage Bucket. Cloudflare sits in front for caching, bot protection and an origin lock. In the app: Drizzle ORM, Better Auth (users and sessions in Postgres), an in-memory rate limiter and an in-process job scheduler. External APIs: Stripe, PostHog, Resend and Buffer. Remotion videos render outside the web service. There is no Supabase, Upstash or Vercel. Details are in `docs/IMPLEMENTATION.md`.

- **No volume on the web service.** All state lives in Postgres or the bucket, so deploys have no downtime and replicas stay possible.
- **Single instance for now.** The graph snapshot and rate-limit counters live in memory. If you add replicas, move the counters to Postgres and reload snapshots through `LISTEN/NOTIFY`.
- **Scheduled jobs take a Postgres advisory lock** before running, so a job never runs twice.
- **Trust only Cloudflare.** Reject requests missing the origin-lock header, and read the client IP from `CF-Connecting-IP`.

## Design

Copy the prototype's `:root` CSS variables (light and dark themes) into the global stylesheet unchanged. The fonts are Chivo and Chivo Mono. Pictograms are 32×32 SVG paths in `PICTO`, drawn on tier-coloured tiles with ink borders; reuse them as they are.

## Commands

Node 22, npm. All run from the repo root.

- `npm install` — install deps
- `npm run dev` — Next.js dev server on http://localhost:3000
- `npm run build` — production build (standalone)
- `npm run start` — run the production build
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — Next's ESLint config
- `npm test` — vitest run (parser + graph tests, no DB needed)
- `npm run db:generate` — regenerate Drizzle migrations from `src/db/schema.ts`
- `npm run db:migrate` — apply migrations to `DATABASE_URL`
- `npm run db:seed` — load `legacy/made-of.html` into the DB (idempotent)
- `npm run db:studio` — open Drizzle Studio

Service and account setup (Railway, Cloudflare, Stripe, PostHog, etc.) lives in `docs/SERVICES.md`.
