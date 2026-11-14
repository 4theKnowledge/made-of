# Made Of: implementation status

Last reviewed: 2026-11-03

This doc started as a six-phase build plan handed to an AI agent. Phases 1–3 and most of 5 shipped; the content pipeline and video catalogue are still ahead. The sections below reflect current state, with original wording removed where it no longer matches reality.

## Target architecture

One Next.js service on Railway does all the work, with Railway Postgres and a Railway storage bucket beside it and Cloudflare in front. The service keeps no data of its own, so it redeploys without downtime and can add replicas later. There is no Supabase, Upstash or Vercel.

```
Browser -> Cloudflare (cache, bot protection, origin lock)
        -> Railway project
             web service: one Docker container (pages, API routes, admin, scheduled jobs;
                          graph snapshot and rate-limit counters in memory; no volume)
             Railway Postgres (data, sessions, puzzles)
             Railway Storage Bucket (videos, exports, backups)
Web service -> Stripe, PostHog, Resend, Buffer (over HTTPS, where wired)
Laptop or GitHub Actions -> Remotion renders -> uploads MP4s to the bucket
```

| Need | Choice | Status |
| --- | --- | --- |
| App, API, admin and scheduled jobs | One Next.js service (App Router, TypeScript), standalone Docker, on Railway | **Shipped** |
| Database | Railway Postgres, same project | **Shipped** |
| ORM | Drizzle | **Shipped** |
| Sign-in | Better Auth with Postgres adapter, magic links via Resend | **Shipped** (magic links only; Google/Apple not wired) |
| Files | Railway Storage Bucket | Not yet needed |
| Rate limiting | In-memory limiter in the web service | **Shipped** |
| Cache and bot protection | Cloudflare in front | **Shipped** (origin lock + CF-Connecting-IP) |
| Scheduled jobs | In-process scheduler with Postgres advisory locks | **Shipped** (framework in place; daily-puzzle job TBD) |
| Payments | Stripe Checkout + customer portal | Not shipped |
| Analytics | PostHog | Not shipped |
| Email | Resend | **Shipped** (sign-in) |
| Video | Remotion rendered outside the web service | Not shipped |
| Social scheduling | Buffer API | Not shipped |

### How it runs

- **Deploys.** Push to GitHub, Railway builds the Dockerfile and swaps containers once `/api/health` passes.
- **No volume on the web service.** All state lives in Postgres or the bucket.
- **Graph snapshot.** Built from Postgres at boot (`src/graph/live.ts`); reloaded on content publish/import. The admin reload button lives at `/api/admin/snapshot/reload`.
- **Caching.** Cloudflare caches item pages, sitemap, and `GET /api/link` (daily). Publishing content purges the changed URLs.
- **Origin lock.** A Cloudflare Transform Rule adds a secret header; the service rejects anything without it. Rate limiter keys on `CF-Connecting-IP`.
- **Backups.** Railway Postgres backups.

## Data model

The schema lives in `src/db/schema.ts`. Migrations are in `drizzle/`. Content is now authoritative in Postgres; the `.data.ts` modules seed a fresh DB and no longer function as source of truth.

| Table | Notes |
| --- | --- |
| `items` | id (uuid), slug, name, tier (F/N/M/C/P/S), kind (FK → `kinds.code`), first_appeared, symbol, fact, status (`draft`/`review`/`live`), is_canary, tags[] |
| `kinds` | **Was** `pgEnum item_kind`. Now a table (migration 0009) so admins can add/rename kinds without a schema change. |
| `recipes` | id, item_id, label, position |
| `links` | type (`f`/`w`/`n`/`s`/`e`), target_item_id, recipe_id OR item_id (exactly one), confidence (`established`/`strong`/`debated`/`hypothesis`), note, is_canary |
| `link_evidence` + `evidence_sources` + `sources` | Evidence attachments; many-to-many |
| `combine_themes` + `item_combine_themes` | Admin-managed Combine playable sets (migration 0010). Validator at `/admin/combine/themes/[code]`. |
| `combine_discoveries` | Scoped `endless` / `daily`; lifetime collection for signed-in players |
| `daily_puzzles` | date, start, goal, par, difficulty — answer path never sent to the client |
| `user` / `session` / `account` / `verification` | Better Auth tables |
| `progress` | kind (`daily`/`scratch`/`goal`/`combine`), ref, result jsonb |
| `reports` | user-filed fact reports |
| `subscriptions` | written only by the Stripe webhook (table exists; webhook not wired) |
| `codes` + `code_redemptions` | Invite / promo codes for soft-launch gating |

The schema also seeded `canary` links — present in API responses, excluded from item pages, sitemap and `llms.txt`.

### Corrections to the original guide

- `links.type` has **five** values (`f` made-from, `w` made-with, `n` needs, `s` comes-from, `e` evolved-from). The original guide listed four.
- Lowest confidence is `hypothesis`, not `weak`.
- `item_kind` is no longer an enum.

## API

Public routes:

| Endpoint | Status |
| --- | --- |
| `GET /api/items/[code]` | **Shipped** |
| `GET /api/links/[code]/evidence` | **Shipped** |
| `GET /api/search?q=` | **Shipped** |
| `GET /api/path?from=&to=` | **Shipped** |
| `GET /api/items/[code]/everything` | **Shipped** (entitlement check) |
| `GET /api/link` + `POST /api/link/*` | **Shipped** (daily; moves checked server-side; answer never sent) |
| `GET /api/combine/*` + `POST /api/combine/*` | **Shipped** |
| `POST /api/craft/*` | **Shipped** |
| `POST /api/reports` | **Shipped** |

Admin routes under `/api/admin/*`:

- `items` (list/create/patch/delete + publish/unpublish + bulk + bulk-delete)
- `links` (create/patch/delete), `recipes` (create/patch/delete)
- `kinds` (list/create/patch/delete)
- `combine-themes` (list/create/patch/delete)
- `items/[id]/themes` (replace membership)
- `snapshot/reload`, `export`, `import`
- `codes` (invite management)

All API responses hold at most one item's neighbourhood (plus `everything` for paid). Public GETs are cached briefly at Cloudflare.

## Frontend

| Route | Status |
| --- | --- |
| `/` | **Shipped** (daily puzzle home) |
| `/i/[slug]` and `/explore/[slug]` | **Shipped** (replaces the planned `/[id]`) |
| `/craft` (From scratch) | **Shipped** |
| `/combine` | **Shipped** (added after the original plan) |
| `/link` | **Shipped** |
| `/account` | **Shipped** |
| `/pricing`, `/about`, `/method`, `/privacy`, `/terms` | **Shipped** |
| `/sign-in` | **Shipped** |

Open Graph images and `apple-icon.tsx` are in place; `sitemap.ts` and `robots.ts` are generated; `llms.txt` is served.

Shared components live in `src/components/{common,bowtie,craft,explore,combine,link}/`.

## Admin

| Surface | Status |
| --- | --- |
| `/admin` home | **Shipped** |
| `/admin/tree` — hierarchical disclosure list of all items with inline CRUD on items, recipes, links; filters by status / tier / tag; flat view; bulk edit (status, tags, themes, delete); shift-click range select | **Shipped** |
| `/admin/kinds` — manage the kind vocabulary | **Shipped** |
| `/admin/combine/themes` + `/[code]` — manage Combine themes with reachability validator | **Shipped** |
| `/admin/items/[id]` — dedicated per-item editor (full form; retained alongside the tree modal) | **Shipped** |
| `/admin/pictograms` — pictogram audit | **Shipped** |
| `/admin/bulk`, admin export | **Shipped** |
| `/admin/codes` — invite codes | **Shipped** |

### Still to build

- `/admin/review` — AI drafting / human-approve queue. Draft → review → live state exists on items; the queue UI doesn't.
- `/admin/daily` — review window for upcoming daily puzzles. The 60-day rolling generator job is also missing.
- `/admin/videos` — approve + schedule Remotion-rendered clips (phase 6).

## Anti-scraping

1. **Neighbourhood-only responses** — enforced; only paid `everything` returns more.
2. **Rate limits** — in-memory, keyed on `CF-Connecting-IP` or user id.
3. **Bot protection** — Cloudflare bot fight + origin lock.
4. **Opaque codes** — API uses short random codes (`src/graph/codes.ts`), mapped to slugs server-side.
5. **Canary links** — seeded; appear only in API responses.
6. **Monitoring** — not yet; the daily "touched too many items" job is still ahead.
7. **Terms of use** — in place at `/terms`.

`robots.ts` allows search engines + AI search/citation crawlers on item pages; blocks AI training crawlers; blocks `/api/` and `/admin/` for all.

## Still to ship

Grouped by effort / risk, not phase.

**Payments and entitlements.** Stripe Checkout, customer portal, webhook, `entitlements(user)` wired through every route. `subscriptions` table exists; no code depends on it yet. Family plan is the first SKU.

**Analytics.** PostHog client + server; typed `track()` helper; day-one dashboards (Daily funnel, activation, retention, paywall funnel). Session replay rules per the launch plan.

**Content pipeline.**
- AI drafting script (Claude → items/recipes/links/sources as schema-matching JSON).
- Admin review queue at `/admin/review`.
- Daily puzzle generator + nightly top-up job + `/admin/daily` review window.
- User-report queue surfacing in the same place.

**Video catalogue.** Remotion project, voice-over step, `videos` table, review page at `/admin/videos`, Buffer scheduling. Everything renders outside the web service.

**Monitoring.** Scraping-pattern alerts; nightly `pg_dump` to the bucket (bucket itself not yet provisioned).

## Sources

- [Buffer's API publishing engine case study](https://buffer.com/resources/coding-kitty-case-study/)
