# Security Audit — Made Of

Date: 2026-11-07
Scope: Full-codebase audit (not a diff review). Read-only.

## 1. Summary

The codebase shows generally strong security hygiene for an early-stage product: admin routes are consistently gated through a single `requireAdminApi()` helper, the Combine server-authoritative run path validates state server-side, SQL queries use parameterized Drizzle templates throughout, Better Auth cookies are `httpOnly` + `secure` in prod with `SameSite=Lax`, pictogram SVG writes go through a strict allowlist sanitiser, and `getLiveSnapshot()` filters to `status='live'` so draft/review content never reaches the public graph. An origin-lock middleware fails-closed in production, and the rate limiter is applied to every public graph/game endpoint.

The notable gaps cluster around content-visibility invariants (canary items leak into public surfaces that should hide them) and one client-trusted score endpoint that is still live in parallel with the newer server-authoritative run path.

Counts: **0 Critical**, **3 High**, **4 Medium**, **5 Low/Info**.

---

## 2. Critical & High

### H1. Canary items leak through public item page `/i/[slug]` and `/explore/[slug]`
- **Severity**: High (Hard-rule #4 violation).
- **Files**: `src/graph/queries.ts:49-100` (`getItemPage`), `src/graph/explore.ts:18-93` (`getExploreView`), `src/app/i/[slug]/page.tsx:60-62`, `src/app/explore/[slug]/page.tsx:30-32`.
- **What's wrong**: Both resolvers only filter `isCanary` on *edges*, not on the focal node. An item with `status='live'` AND `is_canary=true` is served as a full item page if anyone navigates to `/i/<canary-slug>` or `/explore/<canary-slug>`. Snapshot loads all live items regardless of the canary flag (`src/graph/load.ts:30-35`).
- **Impact**: CLAUDE.md states "Canary links appear only in API responses, never on item pages, the sitemap or llms.txt." A canary is a honeypot used to detect scraping; exposing it on a public page defeats its purpose. Also means slug enumeration can discover canaries.
- **Fix**: In both resolvers, add `if (node.isCanary && !includeCanary) return null;` right after the slug lookup. `/api/view/:code` explicitly passes `includeCanary: true` (`src/app/api/view/[code]/route.ts:38`) so the API surface still works.

### H2. `llms.txt` emits canary items
- **Severity**: High (Hard-rule #4 violation).
- **File**: `src/app/llms.txt/route.ts:35-37`.
- **What's wrong**: Iterates `live.snapshot.nodes.values()` with no `isCanary` filter. The sitemap at `src/app/sitemap.ts:57` correctly filters canaries; `llms.txt` was overlooked.
- **Impact**: Every canary slug is published to AI crawlers.
- **Fix**: Add `.filter((n) => !n.isCanary)` before the sort/map.

### H3. `/api/combine/result` still accepts client-trusted scores
- **Status**: **Resolved** — T-0195. The route is deleted; `/runs/[id]/finish` is the sole leaderboard writer.
- **Severity**: High.
- **File**: `src/app/api/combine/result/route.ts` (whole file, see lines 14-18 comment).
- **What's wrong**: The route explicitly comments "we trust the client's totals" and writes to `progress` with only clamping. Any signed-in user can POST a crafted body and claim a near-maximum legitimate score (`score` is clamped to 1,000,000, which is huge).
- **Impact**: Leaderboard poisoning. The newer server-authoritative path (`/api/combine/runs/*`) exists but is behind feature flag `COMBINE_SERVER_RUNS`. As long as `/api/combine/result` is live, the server-auth path doesn't close the hole.
- **Fix**: Either (a) retire this endpoint once `COMBINE_SERVER_RUNS=1` is on in prod, or (b) require that submissions reference a finished `combine_runs` row owned by the user with matching totals. The route has no rate limit either — add `limiters.dailyResult` at minimum while it exists.

### H3b. `/api/combine/collection` accepts client-trusted discoveries
- **Status**: **Resolved** — T-0195. POST returns 410 Gone; server derives discoveries from replay-validated state in `discoveries-writer.ts` on every `/checkpoint` and `/finish`.
- **Severity**: High (sibling of H3; separate trust boundary).
- **File**: `src/app/api/combine/collection/route.ts:59-82` (POST handler).
- **What's wrong**: The endpoint writes `combine_discoveries` rows from whatever `ids` + `signatures` the client POSTs. Validation is shape/scope/size only — the server does not cross-check that the user actually made those items in a real run. Caller at `src/combine/useCollection.ts:183`.
- **Impact**: Any signed-in user can POST arbitrary item ids and unlock their lifetime collection (endless *or* daily scope) without play. This defeats the daily-isolation design (CLAUDE.md: "endless grinding can't walk a daily into pre-unlocked items") and poisons any future discovery/badge leaderboard. Orthogonal to H3 — closing the score hole does not close this one.
- **Fix**: Make `/api/combine/collection` read-only, and move discovery writes behind the server-run replay path. `/api/combine/runs/[id]/finish` already computes `final.found` via replay (`src/app/api/combine/runs/[id]/finish/route.ts:138-145`); that list should be the authoritative input to `combine_discoveries`. Checkpoint-time writes are also fine for faster feedback. Client keeps optimistic UI; the server is the write arbiter. Depends on H3's `COMBINE_SERVER_RUNS=1` prerequisite.

### H3c. Server run replay does not pin engine/bundle version
- **Status**: **Resolved** — T-0195. `combine_runs.engine_version` is stamped at `/start`; `/checkpoint` and `/finish` reject replay with 409 + `engineVersionMismatch` on drift. Discipline note added to CLAUDE.md.
- **Severity**: High (integrity, not confidentiality).
- **File**: `src/db/schema.ts` (`combine_runs` table, no `engineVersion` column); `src/combine/server-engine.ts:149-174` (`replayActions`).
- **What's wrong**: Stored runs carry `seed`, `stateJson`, `eventCount`, and `epoch`, but no reducer-version or bundle-hash field. Any reducer change that alters scoring, dealer bias, or recipe resolution silently re-scores every in-flight run on next replay. Candy Crush's 2015 postmortem calls this out specifically.
- **Impact**: Score drift without an audit trail. A reducer edit that raises everyone's existing runs' scores by 5% is indistinguishable from ambient leaderboard movement. Also opens a timing attack: an attacker who notices a scoring buff in a deploy can delay their `/finish` until after cutover to collect the higher score.
- **Fix**: Add `combine_runs.engine_version INT NOT NULL DEFAULT 1`. Stamp on `createRun`. On replay, reject (409 + state) when `stored.engineVersion !== CURRENT_VERSION` and bump `epoch`. Protocol: every scoring-affecting reducer change bumps a `const ENGINE_VERSION`; a CI test asserts the constant changed when reducer/scoring files did.

---

## 3. Medium

### M1. `picker` endpoint exposes canary items
- **Severity**: Medium (Hard-rule #4 partial violation).
- **File**: `src/app/api/craft/picker/route.ts:40-60`.
- **What's wrong**: The route's doc comment claims "we limit it to live, non-canary items", but the loop has no `if (n.isCanary) continue;` filter. Only recipe presence + tier are checked.
- **Impact**: Canary slugs leak to anyone browsing the craft picker.
- **Fix**: Add the canary filter at the top of the loop (matches `src/app/api/search/route.ts:44`).

### M2. Magic-link URL logged to stdout when `RESEND_API_KEY` is unset in production
- **Severity**: Medium.
- **File**: `src/lib/auth.ts:211-213`.
- **What's wrong**: `if (!process.env.RESEND_API_KEY) { console.log(…url…); return; }` runs inside the production branch. The magic-link URL is a one-time credential; anyone reading Railway logs (or a log-aggregator with weak ACLs) could grab it and complete sign-in as the requester.
- **Impact**: Account takeover of anyone who requests a magic link during a misconfiguration window.
- **Fix**: In production with no Resend key, throw (fail-closed) so the sign-in POST returns 500 and the URL is never minted-and-logged. Never log the raw URL in prod.

### M3. No security response headers; everything relies on Cloudflare
- **Severity**: Medium.
- **File**: `next.config.ts` (no `async headers()` block).
- **What's wrong**: No `Content-Security-Policy`, `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`, `X-Content-Type-Options`. If Cloudflare is ever bypassed, misconfigured, or disabled (per the `ORIGIN_LOCK_DISABLED` env escape hatch at `src/middleware.ts:66`), the app ships without any browser-side hardening. CSP in particular matters because the app renders `dangerouslySetInnerHTML` for pictograms, OG images, and changelog markdown.
- **Fix**: Add an `async headers()` block returning a baseline (`Content-Security-Policy` scoped to `/ingest` for PostHog + `fonts.googleapis.com`; `frame-ancestors 'none'`; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`). Defense-in-depth alongside Cloudflare.

### M4. `/api/combine/daily/leaderboard` has no rate limit
- **Severity**: Medium.
- **File**: `src/app/api/combine/daily/leaderboard/route.ts`.
- **What's wrong**: The handler runs a non-trivial `DISTINCT ON` query against `progress` on every call with no `withRateLimit` wrapper. An attacker can trivially cause DB load. Also no cache headers.
- **Fix**: Wrap with `withRateLimit(req, limiters.search, visitorKey(req), …)` and add `cache-control: public, s-maxage=60`.

---

## 4. Low / Info

- **L1. Changelog markdown URL attribute injection (admin-only XSS)** — `src/lib/changelog/markdown.ts:38` interpolates the matched href into `href="${safe}"` with no quote-escaping. A link like `[x](/path" onclick="alert(1))` would inject an attribute. Admin-only writers can already exfiltrate data, so this is defense-in-depth only. Fix: escape `"` in href, or match the href against a stricter regex.
- **L2. `/api/items/:id/everything` entitlement is a dev-only stub** — `src/app/api/items/[code]/everything/route.ts:58-63` returns `false` in production unconditionally, so the paid endpoint is currently non-functional. Safe today, but when the paid tier ships this must be swapped for a real Better Auth + entitlements lookup (TODO is already in the file).
- **L3. No explicit CSRF token on state-changing JSON APIs** — `SameSite=Lax` cookies + no permissive CORS make CSRF low-risk, but there is no explicit token defense on `/api/combine/*`, `/api/feedback`, `/api/account/handle`, `/api/craft/make`, etc. A future permissive CORS or a browser SameSite regression would expose these. Consider a double-submit cookie or Better Auth's CSRF helper.
- **L4. `.env` and `.env.local` exist on the author's disk** — gitignored and not tracked (verified via `git ls-files`), but worth confirming they never get committed. `.env.example` is the only one tracked.
- **L5. `ORIGIN_LOCK_DISABLED=1` is a bypass that leaves no audit trail** — `src/middleware.ts:66` lets the Cloudflare lock be flipped off by an env var. If it's left on by mistake, the Railway origin is reachable directly and `cf-connecting-ip` becomes forgeable (which `visitorKey()` in `src/api/rate-limit.ts:126-132` trusts blindly). Document that this is for pre-cutover only and add a startup log warning whenever the flag is set.

---

## 5. Hard-rule compliance checklist

1. **Never send the whole graph** — ✅ enforced. Every public endpoint returns a single neighbourhood or a bounded list. `/api/items/:code/everything` is the one exception and is entitlement-gated (stubbed to always-false today, see L2).
2. **Daily answers stay server-side** — ✅ enforced. `/api/link/*` computes deltas and legal-move checks server-side; `/api/link` returns only start/goal/par (no path). `src/app/api/link/move/route.ts` only leaks `closer|same|further`.
3. **Entitlements server-side** — ⚠️ partial. Admin gating is solid. Paid entitlement on `/everything` is a stub (safe default, L2). `/api/combine/result` accepts client totals (H3).
4. **Only `status=live` content public; canaries hidden on pages/sitemap/llms.txt** — ❌ not fully enforced. `status='live'` is enforced via `loadRowsFromDb({ liveOnly: true })` in `src/graph/load.ts:30-35`. Canary filtering has gaps: H1 (item/explore pages), H2 (llms.txt), M1 (picker).
5. **No child profiles; no session replay; no person properties** — ✅ `disable_session_recording: true`, `person_profiles: "identified_only"` in `src/lib/analytics/client.ts:19`.
6. **`track()` identifies by user id only** — ✅ `src/lib/analytics/client.ts:32` calls `posthog.identify(userId)`; no email/name passed anywhere found.
7. **Trust only Cloudflare; CF-Connecting-IP only when origin-lock passes** — ⚠️ partial. Origin lock fails-closed in production (`src/middleware.ts:68-74`), but `/api/health` is matched out of the middleware and the `ORIGIN_LOCK_DISABLED=1` env knob bypasses it. `visitorKey()` reads `cf-connecting-ip` unconditionally — fine when the lock is active, but see L5.
8. **Crawlers: allow search/AI citation on items, block training, block /api/ and /admin/** — ✅ `src/app/robots.ts` implements this.
9. **NEXT_PUBLIC_\* declared as ARG+ENV in Dockerfile** — ⚠️ partial. `NEXT_PUBLIC_COMBINE_PLAYTEST` is declared at `Dockerfile:27-28`. `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_DEV_ADMIN_EMAIL` are *not* declared as ARGs — they will be empty on the client in production. If any of those are supposed to work client-side in prod, that's a functional bug (not a security one, but worth checking).

---

## 6. Audit gaps

- **Better Auth internals**: `originCheck` is confirmed on the magic-link verify endpoint but not every Better Auth endpoint exposed via `/api/auth/[...all]` was exhaustively validated. Worth confirming that `/sign-in/magic-link` body-validation and the `list-sessions` / `delete-user` endpoints are exposed with the expected auth gates for this app's config.
- **Cloudflare WAF rules**: Rate limits, bot rules, and the Transform Rule that adds `x-origin-lock` live in the Cloudflare dashboard. Verify the Transform Rule is actually configured and the secret matches `ORIGIN_LOCK_SECRET` in Railway.
- **Stripe webhook**: No Stripe code present in the repo (the paid tier appears unshipped). Confirm this is intentional before launch.
- **`NEXT_PUBLIC_*` runtime behaviour**: Four of the five `NEXT_PUBLIC_*` vars read by client/edge code aren't declared as build ARGs in the Dockerfile. If PostHog analytics is working in prod, confirm those are set as build-time variables on Railway (not just service env), or the client bundle will see `undefined`.
- **Scheduled jobs / cron advisory locks**: CLAUDE.md mentions "Scheduled jobs take a Postgres advisory lock". Only the internal `/api/internal/combine-dailies/extend` handler was reviewed; broader cron code wasn't surveyed.
- **Server-authoritative Combine engine**: `src/combine/server-engine.ts` replay semantics were not deeply audited. The route handlers around it look correct (owner scoping, event-count ordering, admin-only debug), but subtle bugs in the replay engine could allow score inflation via crafted action sequences.
