# Made Of: AI implementation guide

Oct 28, 2026 · @Tyler

## How to use this guide

Hand this guide to an AI coding agent one phase at a time, and check each phase's acceptance criteria before starting the next. The source of truth for content and behaviour is the current Made Of artifact, a single 509 KB HTML file.

Working rules for the agent:

- Commit this guide to the repo as `docs/IMPLEMENTATION.md` and a short `CLAUDE.md` that points to it.
- Work in one phase per branch; open a pull request at the end of each phase.
- Port behaviour, don't redesign. The look, copy and interactions of the artifact are the spec.
- Never ship the whole graph to the browser (see Anti-scraping).
- Write tests for the graph functions (neighbours, path, daily) before porting the UI.
- Ask before adding a new paid service.

## Target architecture

One Next.js service on Railway does all the work, with Railway Postgres and a Railway storage bucket beside it and Cloudflare in front. The service keeps no data of its own, so it redeploys without downtime and can add replicas later. There is no Supabase, Upstash or Vercel.

```
Browser -> Cloudflare (cache, bot protection, origin lock)
        -> Railway project
             web service: one Docker container (pages, API routes, admin, scheduled jobs;
                          graph snapshot and rate-limit counters in memory; no volume)
             Railway Postgres (data, sessions, puzzles)
             Railway Storage Bucket (videos, exports, backups)
Web service -> Stripe, PostHog, Resend, Buffer (over HTTPS)
Laptop or GitHub Actions -> Remotion renders -> uploads MP4s to the bucket
```

The browser also sends analytics straight to PostHog. Video renders run outside the web service, on your machine or in GitHub Actions, so they never slow the site.

| Need | Choice | Why |
| --- | --- | --- |
| App, API, admin and scheduled jobs | One Next.js service (App Router, TypeScript), built as a standalone server from a Dockerfile, on Railway | One thing to deploy, log and debug |
| Database | Railway Postgres, in the same Railway project | Managed next to the app; Drizzle works unchanged |
| ORM | Drizzle | Typed schema and plain SQL migrations |
| Sign-in | Better Auth, with users and sessions stored in Postgres | Runs inside the app; magic links, Google and Apple; no auth vendor |
| Files | Railway Storage Bucket (S3-compatible, private) | Videos, exports and backups, shared through presigned URLs |
| Rate limiting | In-memory limiter inside the service | One instance needs no Redis; move the counters to Postgres if replicas are added |
| Cache and bot protection | Cloudflare, free plan, in front of Railway | Caches public pages, absorbs traffic spikes, blocks bots |
| Scheduled jobs | In-process scheduler in the web service | No extra service; a Postgres lock stops a job running twice |
| Payments | Stripe Checkout and customer portal | No payment UI to build |
| Analytics | PostHog | Events, replays, flags and experiments in one tool |
| Email | Resend | Magic links and the weekly newsletter |
| Video | Remotion, rendered outside the web service | Videos as React components rendered from the graph |
| Social scheduling | Buffer API | One call per post to TikTok, Reels and YouTube |

### How it runs

- **Deploys.** Pushing to GitHub makes Railway build the Dockerfile and swap in the new container once `/api/health` passes. Railway PR environments give each pull request a preview.
- **No volume on the web service.** Railway volumes block replicas and cause brief downtime on every redeploy ([Railway docs](https://docs.railway.com/volumes/reference)). All state lives in Postgres and the bucket.
- **Graph snapshot.** Loaded into memory from Postgres at boot, and reloaded when content is published. Use Postgres `LISTEN/NOTIFY` for the reload signal, so it still works if replicas are added.
- **Caching.** Cloudflare caches item pages, the sitemap and `GET /api/daily`. Publishing content purges the changed URLs through the Cloudflare API.
- **Origin lock.** A Cloudflare Transform Rule adds a secret header, and the service rejects requests without it, so bots can't bypass Cloudflare through the railway.app address. The rate limiter keys on `CF-Connecting-IP`.
- **Scheduled jobs.** Daily-puzzle top-up, the scraper report, Buffer scheduling and a nightly `pg_dump` to the bucket. Each job takes a Postgres advisory lock before it runs.
- **Backups.** Railway's Postgres backups plus the nightly dump in the bucket. The bucket has no automatic backups of its own ([Railway docs](https://docs.railway.com/storage-buckets)), so keep videos reproducible from the graph.
- **When to split.** If jobs ever slow the site, run them as a second Railway service from the same image with a different start command. Not before.

## Data model

Store the graph in Postgres as items, recipes and typed links, with evidence and sources hanging off links. Use Drizzle ORM for the schema and migrations.

| Table | Key columns | Notes |
| --- | --- | --- |
| `items` | `id` (slug), `name`, `tier` (F, N, M, C, P, S), `kind`, `first_appeared`, `symbol`, `fact`, `status` (draft, review, live), `is_canary` | 276 rows today. `status` gates what the public API serves. |
| `recipes` | `id`, `item_id`, `label` (e.g. bacterial, algal), `position` | An item can be made more than one way. A recipe with no label is the default. |
| `links` | `id`, `recipe_id` or `item_id`, `type`, `target_item_id`, `confidence` (established, strong, debated, weak) | `type` mirrors the prefixes in the HTML: `f`, `e`, `n`, `s`. Confirm each meaning from the artifact's parser. |
| `link_evidence` | `link_id`, `type`, `stance` (supports, contradicts), `summary` | 354 evidenced links today |
| `sources` | `id` (e.g. src:martin-2008), `kind`, `title`, `authors`, `year`, `published`, `url` | 413 rows today |
| `evidence_sources` | `evidence_id`, `source_id` | Many to many |
| `daily_puzzles` | `date`, `start_item`, `goal_item`, `par`, `difficulty` | Generated ahead; the answer path is never sent to the browser |
| `users`, `profiles` | Better Auth's user, session and account tables, plus display name and plan on the user | No child profiles in phase 1 |
| `progress` | `user_id`, `kind` (daily, scratch, goal), `ref`, `result`, `created_at` | Streaks and history |
| `reports` | `user_id`, `item_id` or `link_id`, `reason`, `note`, `status` | Replaces the artifact database |
| `subscriptions` | `user_id`, `stripe_customer_id`, `plan`, `status`, `current_period_end` | Written only by the Stripe webhook |

Precompute a graph snapshot (adjacency lists) into memory on each server instance at boot and after each content publish. Pathfinding and "everything it takes" run against the snapshot, not SQL.

## Migration

Extract the data with a one-off script, load it into Postgres, and prove the round trip before touching the UI.

1. **Get the file.** Download the Made Of artifact HTML into `legacy/made-of.html`. Keep it in the repo as the reference implementation.
2. **Extract `DATA`.** It is a template string of pipe-separated lines: `name|tier|kind|date|symbol|recipes|other links|fact`. Recipes are separated by `/`, may start with a `[label]`, and list targets after a type prefix like `f:`.
3. **Extract `EVIDENCE`.** It is a JSON object with `links` (ids like `RNA<f<nucleotides`, confidence, note, evidence list) and `sources` (keyed by `src:` ids).
4. **Copy the parser.** Port the artifact's own parsing code to TypeScript rather than writing a new one, so edge cases match.
5. **Load.** A seed script inserts items, recipes, links, evidence and sources in one transaction.
6. **Verify.** A test re-exports the database to the same structures and diffs them against the HTML: 276 items, 354 evidenced links, 413 sources, no orphans.
7. **Port the graph functions** (neighbours, path, everything-it-takes, recipe switching) with unit tests using cases taken from the current app.

After migration the database is the source of truth. Content changes go through the content pipeline, never by editing a file.

## API design

Every endpoint returns at most one item's neighbourhood or one answer, never the graph. All run as Next.js route handlers on the server.

| Endpoint | Returns | Access | Rate limit |
| --- | --- | --- | --- |
| `GET /api/items/:id` | The item, its recipes, direct inputs and outputs, link confidence | Public | 60 a minute per IP |
| `GET /api/links/:id/evidence` | Evidence and sources for one link | Public | 30 a minute per IP |
| `GET /api/search?q=` | Up to 10 matching items, names and icons only | Public | 30 a minute per IP |
| `GET /api/path?from=&to=` | One shortest path | Public, 5 a day signed out; unlimited signed in | 10 a minute per user |
| `GET /api/items/:id/everything` | The full tree an item depends on | Family plan | 10 a minute per user |
| `GET /api/daily` | Today's start, goal and par; no answer | Public | 30 a minute per IP |
| `POST /api/daily/move` | Whether a step is valid, plus hints | Public; session-bound | 120 a minute per session |
| `POST /api/daily/result` | Saves the result and streak; returns the share text | Public; streak needs sign-in | 10 a minute |
| `POST /api/scratch/*` | From scratch game state | Free with limits, full on Family | 120 a minute |
| `POST /api/reports` | Files a fact report | Signed in | 10 an hour |

The Daily link checks every move on the server, so the answer path never leaves it. Cache public `GET`s at Cloudflare for a few minutes.

## Frontend port

The Daily link is the home page; Explore and every item page sit one tap away. Port the artifact's CSS and markup into components with as little change as possible.

| Route | Rendering | Content |
| --- | --- | --- |
| `/` | Server-rendered shell, client game | The Daily link, with a link to Explore underneath the result |
| `/explore` and `/explore/[id]` | Server-rendered first item, client navigation after | The bowtie |
| `/[id]` (e.g. `/glass`) | Static, regenerated on content publish | Public item page: name, pictogram, fact, inputs, outputs, sources, "Explore this" button. Includes JSON-LD and Open Graph image. |
| `/scratch` | Client | From scratch game |
| `/pricing`, `/about` | Static | Ported pages |
| `/account` | Server, signed in | Plan, streaks, history |

Components to extract: `Pictogram`, `Chip`, `FocusCard`, `Bowtie` (with its wires), `EvidenceDrawer`, `Trail`, `DailyBoard`, `ShareSquares`, `ScratchBoard`, `Tour`.

Generate `sitemap.xml` from live items, and an Open Graph image per item and per daily result so shared links show a card.

## Accounts, payments, entitlements

Use Better Auth inside the app for sign-in, with users and sessions in Postgres, and Stripe Checkout for payments, with one `entitlements(user)` function deciding what each user can do.

- **Sign-in:** email magic link sent through Resend, plus Google and Apple. No passwords to manage.
- **Anonymous play:** a signed cookie holds a session id so the Daily link works without an account. On sign-up, merge that session's progress into the new account.
- **Payments:** Stripe Checkout for Family (monthly and yearly) and the Stripe customer portal for changes and cancellation. Educator comes later.
- **Webhook:** `POST /api/stripe/webhook` is the only writer of `subscriptions`. Verify signatures; make it idempotent.
- **Entitlements:** one function returns flags such as `canSeeEverything`, `scratchLevels`, `pathsPerDay`. Every API route and page checks it; the UI only hides what the server already blocks.
- **Age:** the terms state 13 or older. No child profiles until phase 2 (see the launch plan).

## Anti-scraping and rate limiting

Make bulk copying slow, noisy and provable; accept that single pages are public.

1. **Neighbourhood-only responses.** No endpoint returns more than one item's direct links, except `everything`, which needs a paid account.
2. **Rate limits** with an in-memory limiter in the web service, keyed by the visitor IP from Cloudflare's CF-Connecting-IP header, or by user id when signed in. If replicas are added, move the counters to Postgres. Limits are in the API table.
3. **Bot protection** with Cloudflare: bot fight mode, plus firewall rules blocking known scraper user agents and data-centre IP ranges on the API routes, not on item pages. The origin lock stops anyone skipping Cloudflare.
4. **Opaque ids in the API.** The client uses short random ids, mapped to slugs on the server, so the graph can't be walked by guessing names.
5. **Canary content.** Seed a few plausible but invented links (`is_canary`) that appear only in API responses, never on item pages. Their appearance elsewhere proves copying.
6. **Monitoring.** A daily job flags accounts or IPs that touched more than a set share of items, and alerts by email.
7. **Terms of use** forbid automated extraction.

**robots.txt:** allow search engines and AI search or citation crawlers on item pages; disallow AI training crawlers everywhere; disallow `/api/` and `/admin/` for all. Serve an `llms.txt` listing live item pages, and add schema.org markup to every item page (see Search and AI search in the launch plan).

Don't obfuscate the JavaScript or block search engines; that costs SEO and stops nobody determined.

## Analytics instrumentation

Wire PostHog in phase 1 using the event plan in the launch plan, through one typed `track()` helper so event names can't drift.

- **Client:** `posthog-js` initialised in a provider, with `person_profiles: 'identified_only'` so anonymous visitors don't create profiles.
- **Server:** `posthog-node` for money and answers: `daily_solved`, `subscription_started`, `checkout_started`. Flush before the route returns.
- **Identify** on sign-in with the Better Auth user id only; no email or name as properties.
- **Typed events:** one `events.ts` file exports a union of event names and their property types. `track()` accepts only those.
- **Session replay:** on for signed-in adults with all inputs masked; a small sample of anonymous visitors; never for any future child profile.
- **Feature flags:** use them for paywall placement, Daily difficulty and price tests.
- **Consent:** EU visitors see a banner; until they accept, run PostHog without cookies (memory persistence).
- **Dashboards to build on day one:** Daily funnel (started, solved, shared), new-visitor activation, weekly retention, paywall funnel.

## Content pipeline

AI drafts, a human approves, and nothing reaches the public graph without a reviewed status. The same pipeline feeds the video catalogue.

### Facts and links

1. **Propose.** A script asks Claude for new items around a theme ("kitchen", "phone"), returning items, recipes, links and candidate sources as JSON matching the schema.
2. **Check.** Automated checks: every source URL resolves, no duplicate items, no cycles that the app doesn't allow, every link has a confidence.
3. **Review.** An admin page at `/admin/review` shows each draft with its sources; approve, edit or reject. Status moves draft → review → live.
4. **Publish.** Approval rebuilds the graph snapshot and regenerates affected item pages.
5. **Reports.** User reports land in the same queue.

### Daily puzzles

Generate puzzles automatically on a rolling 60-day window, not six months in one go. A nightly job tops the queue back up to 60 days, so new items join puzzles within weeks and you always have time to review.

1. **Candidates.** Pick start and goal pairs from live items whose shortest path is 3 to 7 steps.
2. **No-repeat rules.** Never reuse a start and goal pair. Don't reuse a goal item within 90 days, or a start item within 30. Keep these as settings.
3. **Difficulty curve.** Easy early in the week, hardest at the weekend, judged by path length and the number of branches.
4. **Quality check.** Reject pairs that pass through `debated` or `weak` links, or canary links.
5. **Review.** The next 14 days show in `/admin/daily` for a skim; anything not rejected publishes automatically.
6. **Freeze.** A puzzle locks once its date arrives, so everyone that day plays the same one.

### Video catalogue and auto-publishing

Render short videos from the graph itself with Remotion (React components rendered to MP4), so every clip is on-brand and factually tied to reviewed data. AI writes the script and voice-over; the visuals are your pictograms and chains, not generated footage.

1. **Pick.** A weekly job chooses chains worth a clip (e.g. pencil back to the big bang) and writes a `videos` row: chain, script, status.
2. **Script and voice.** Claude drafts a 30-second script from the chain's facts; a text-to-speech service records it.
3. **Render.** Remotion renders 9:16 MP4s plus a caption file on your machine or in GitHub Actions, never in the web service, and uploads them to the Railway storage bucket. Buffer receives a presigned URL, because the bucket is private.
4. **Review.** Approve in `/admin/videos`; you watch every clip before it is scheduled.
5. **Schedule.** Approved clips go to Buffer through its GraphQL API, which accepts a video URL and can post to TikTok, Instagram Reels and YouTube ([Buffer](https://buffer.com/resources/coding-kitty-case-study/)). Schedule a fixed cadence such as three a week.
6. **Measure.** Each clip links to its item page with a UTM tag so PostHog shows which clips bring players.

The catalogue table: `videos` (`id`, `chain`, `script`, `audio_url`, `video_url`, `status`, `buffer_post_id`, `scheduled_for`).

## Phased task list

Six phases, each one pull request, each with a prompt to hand the agent and a test of done.

### Phase 1: Foundation and data

> Prompt: "Set up a Next.js App Router project with TypeScript and Drizzle on Postgres, with a Dockerfile that builds Next.js in standalone mode for Railway. Implement the schema in docs/IMPLEMENTATION.md. Write a seed script that parses legacy/made-of.html using a TypeScript port of its own parser, and a round-trip test."

- [ ] Repo, CI, Dockerfile, Railway service and Postgres, PR environments, Cloudflare in front with the origin lock
- [ ] Schema and migrations
- [ ] Seed script and round-trip test
- [ ] Graph snapshot with unit tests for neighbours, path and everything-it-takes

Done when: the test reports 276 items, 354 evidenced links and 413 sources, and graph tests pass.

### Phase 2: API and anti-scraping

> Prompt: "Build the API routes in the API design table, with an in-memory rate limiter keyed on CF-Connecting-IP or user id, and opaque ids. No route may return more than one item's neighbourhood except /everything."

- [ ] All routes with tests
- [ ] Rate limits and opaque ids
- [ ] Canary links seeded

Done when: a test crawler gets rate-limited, and no response contains the full graph.

### Phase 3: Frontend port

> Prompt: "Port the Daily link, Explore and From scratch modes from legacy/made-of.html into React components, keeping CSS and copy. The Daily link is the home page. Data comes only from the API."

- [ ] Components extracted
- [ ] Daily link at `/` with server-checked moves
- [ ] Explore and item pages, sitemap, Open Graph images
- [ ] From scratch

Done when: side-by-side screenshots match the artifact on phone and desktop, and item pages pass a rich-results test.

### Phase 4: Accounts, payments, analytics

> Prompt: "Add Better Auth with the Drizzle adapter, magic links through Resend, anonymous sessions that merge on sign-up, Stripe Checkout and webhook for the Family plan, one entitlements function, and PostHog with the typed event list."

- [ ] Sign-in and session merge
- [ ] Stripe Checkout, portal and webhook
- [ ] Entitlements checked in every route
- [ ] PostHog events and day-one dashboards

Done when: a test purchase unlocks Family features and every planned event shows in PostHog.

### Phase 5: Admin and content pipeline

> Prompt: "Build /admin (owner only) with review queues for drafted content, reports and daily puzzles, plus the nightly daily-puzzle job with the no-repeat rules."

- [ ] Review queue and publish flow
- [ ] Daily puzzle generator and 60-day queue
- [ ] AI drafting script

Done when: 60 days of puzzles are queued and an AI-drafted item can go from draft to live.

### Phase 6: Video catalogue

> Prompt: "Add a Remotion project that renders a 9:16 chain video from an item id, a videos table, an admin review page, and a job in the web service that schedules approved videos through Buffer's API. Renders run on my machine or in GitHub Actions, not in the web service."

- [ ] Remotion template
- [ ] Script and voice-over step
- [ ] Review page and Buffer scheduling

Done when: an approved clip appears scheduled in Buffer with a tracked link back to its item page.

## Sources

- [How the engineer behind Coding Kitty built a video publishing engine on Buffer's API, Buffer](https://buffer.com/resources/coding-kitty-case-study/)
