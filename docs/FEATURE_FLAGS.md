# Feature flags

Scope and recommendation for easy-to-control feature gating across the app.

## Immediate need

Hide `/link` and `/craft` in production while still iterating on them. Both are visible today:

- `src/components/common/Header.tsx` lists them in the nav.
- `src/app/not-found.tsx` and `src/app/about/page.tsx` link to them.
- `src/components/link/LinkModeDialog.tsx` deep-links into `/link`.
- `src/app/sitemap.ts` likely includes them for SEO.
- `src/app/robots.ts` doesn't block them.
- `src/app/llms.txt` may list them.

Hiding needs to cover both navigation (no links shown) and routes (visiting `/link` directly returns 404 or redirects), without deleting any code.

## Approaches, cheapest to richest

### A — Env var constants

A `src/lib/features.ts` module reads `process.env.FEATURE_X` at build time, exports booleans.

- **Pros:** Zero infra. One place to flip. Works in server components, route handlers, client components (via Next.js build-time inlining of `NEXT_PUBLIC_*`).
- **Cons:** Toggling needs a redeploy. Can't vary per user or do A/B testing. No admin UI.

Right for: "turn `/link` off in prod right now and worry about dynamic flags later."

### B — DB-backed flags with an in-memory cache

A `feature_flags` table (code pk, enabled bool, description, updatedAt). A `src/lib/flags.ts` module loads them at boot into a `Map<string, boolean>`, exposed as `isEnabled(code)`. Admin page at `/admin/flags` to flip them. Reload via the same snapshot-reload mechanism we already have (or `LISTEN/NOTIFY` on the table).

- **Pros:** No redeploy. Admin can flip in production. Shape ready for per-user targeting later. Caches so no DB hit per request.
- **Cons:** New table, new migration, new admin page, new snapshot wiring. ~250 lines across 5 files.

Right for: "I want control without deploying" — this is where most apps land.

### C — PostHog (or similar) feature flags

PostHog has feature flags built in — percentage rollouts, user targeting, A/B tests, flag-gated events. CLAUDE.md and the launch plan both call out PostHog as the analytics choice.

- **Pros:** Rollout percentages, targeting rules (plan tier, country, user id), kill switches without touching your code. Experimentation.
- **Cons:** PostHog isn't shipped yet. Adds a runtime dep and a round-trip (SDK caches client-side after first fetch, so it's cheap in steady state). Flag SDK runs in the browser; server-side flag checks need `posthog-node`.

Right for: "I want proper experimentation" — but a dependency to defer until PostHog is wired for analytics anyway.

## Recommendation

**A now, B when A hurts, C when PostHog ships.**

Specifically:

1. **Today (10 minutes):** Add `src/lib/features.ts` with env-var-backed booleans and gate the nav + routes. Ships the immediate `/link` and `/craft` hiding, zero infra, no new tests to write.
2. **This month (half-day):** Upgrade to the DB-backed `feature_flags` table + `/admin/flags` page when env vars start feeling like a bottleneck (second person wants to flip something, or you want to A/B without deploying). Same `isEnabled()` call site stays — only the backing store changes.
3. **When PostHog lands:** The analytics PR adds `posthog-node`. At that point `isEnabled()` reads from PostHog's `getFeatureFlag(flagKey, userContext)` when a user context is available; falls back to the DB flag when it isn't. One abstraction, three progressively richer backings.

Keeping the function signature stable (`isEnabled(code, { user? })`) through all three means every call site is forward-compatible.

## Design for approach A (ship now)

### `src/lib/features.ts`

```ts
/**
 * Feature flags, env-driven.
 *
 * Each flag has a default and reads from a NEXT_PUBLIC_FEATURE_* env var
 * so client components can see it at build time. Set to "0" to disable,
 * anything else to enable. Flipping requires a redeploy today; the
 * backing store will move to DB when FEATURE_FLAGS.md promotes to
 * approach B.
 */

const FLAGS = {
  link: { env: "NEXT_PUBLIC_FEATURE_LINK", default: false },
  craft: { env: "NEXT_PUBLIC_FEATURE_CRAFT", default: false },
  combine: { env: "NEXT_PUBLIC_FEATURE_COMBINE", default: true },
  explore: { env: "NEXT_PUBLIC_FEATURE_EXPLORE", default: true },
} as const;

export type FeatureCode = keyof typeof FLAGS;

export function isEnabled(code: FeatureCode): boolean {
  const def = FLAGS[code];
  const raw = process.env[def.env];
  if (raw == null || raw === "") return def.default;
  return raw !== "0" && raw.toLowerCase() !== "false";
}
```

### Call sites

**Header nav** — filter out the links when disabled:

```tsx
const navItems = [
  isEnabled("link") && { href: "/link", label: "Link", key: "link" },
  isEnabled("craft") && { href: "/craft", label: "Craft", key: "craft" },
  isEnabled("combine") && { href: "/combine", label: "Combine", key: "combine" },
  // ...
].filter(Boolean);
```

**Routes themselves** — add a check at the top of each gated page:

```tsx
// src/app/link/page.tsx
import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/features";

export default async function LinkPage() {
  if (!isEnabled("link")) notFound();
  // existing page
}
```

Same for `/craft/page.tsx`. Also for any API routes under `/api/link/*` and `/api/craft/*` — return 404 when disabled so direct API calls can't play the hidden games.

**Sitemap + llms.txt + robots** — skip disabled routes:

```ts
// src/app/sitemap.ts
if (isEnabled("link")) entries.push({ url: "/link", ... });
```

**Deep links from other pages:**
- `src/app/not-found.tsx` and `src/app/about/page.tsx` — conditionally render the link.
- `src/components/link/LinkModeDialog.tsx` — gate the whole dialog (if link is off, dialog never shows).

### Env setup

Set these in Railway:

```
NEXT_PUBLIC_FEATURE_LINK=0
NEXT_PUBLIC_FEATURE_CRAFT=0
```

Dev `.env.local`:

```
NEXT_PUBLIC_FEATURE_LINK=1
NEXT_PUBLIC_FEATURE_CRAFT=1
```

That way local dev sees everything, prod hides them until you redeploy with the flag flipped on.

### What the disabled routes return

Three options:

- **`notFound()` (404)** — honest and SEO-safe. Google sees nothing there. *(Recommended.)*
- **Redirect to `/`** — some users bookmarked `/link`; one less confused tap. Downside: redirect-chain for bots.
- **"Coming soon" page** — build hype. More work; feels forced for games that *used to exist*.

### Scope of first PR

| File | Change |
| --- | --- |
| `src/lib/features.ts` | New, ~40 lines |
| `src/components/common/Header.tsx` | Filter nav items |
| `src/components/common/Footer.tsx` | Same (if link/craft referenced) |
| `src/app/link/page.tsx` | `notFound()` when disabled |
| `src/app/craft/page.tsx` | Same |
| `src/app/api/link/**/route.ts` | Return 404 when disabled |
| `src/app/api/craft/**/route.ts` | Same |
| `src/app/sitemap.ts` | Skip disabled routes |
| `src/app/robots.ts` | Optional: disallow disabled routes |
| `src/app/llms.txt` | If dynamic, skip disabled; if static, manual |
| `src/app/not-found.tsx`, `src/app/about/page.tsx` | Conditional links |
| `src/components/link/LinkModeDialog.tsx` | Gate at component level |
| Railway env vars | `NEXT_PUBLIC_FEATURE_LINK=0`, `NEXT_PUBLIC_FEATURE_CRAFT=0` |

~150 lines total. Half a day with testing.

## Design sketch for approach B (when env vars hurt)

**Schema:**

```ts
export const featureFlags = pgTable("feature_flags", {
  code: text("code").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Loader:** `src/lib/flags.ts` loads all flags into a `Map` at boot, exposed via `getLiveFlags()`. Mutates via `reloadFlags()` after admin writes. Falls back to env-var defaults if the DB row is missing (so new flags default-safely before anyone sets them).

**API routes:** `GET /api/admin/flags`, `PATCH /api/admin/flags/[code]` — standard CRUD, same pattern as kinds/themes.

**Admin page:** `/admin/flags` — simple table of flags with toggle switches. Writes patch, calls `reloadFlags()`, done.

**Call sites unchanged** — same `isEnabled(code)` function, just reads the Map instead of env vars.

Rough cost: ~250 lines + one migration + one admin page.

## Design sketch for approach C (when PostHog lands)

**Signature evolves** to accept optional user context:

```ts
export async function isEnabled(code: FeatureCode, ctx?: { userId?: string }): Promise<boolean>
```

**Server-side:** `posthog-node`'s `getFeatureFlag(code, distinctId)` for signed-in users; falls back to DB flag or env default.

**Client-side:** `posthog-js` already caches flag state after first fetch. A `useFeatureFlag(code)` hook reads from the PostHog provider.

**Admin page stays** as the source of truth for flags not managed in PostHog, so you can gate "under construction" features without creating PostHog entries.

## Open questions

### Q1 — Start with approach A, promote later?

- [ ] **Yes, A → B → C as needed.** *(leaning this way — ships today, upgrades painlessly)*
- [ ] Start with B. Half-day investment up front but no future migration.
- [ ] Something else: ____

### Q2 — Disabled route behaviour

- [ ] **404 via `notFound()`.** SEO-safe. Google deindexes. *(leaning this way)*
- [ ] Redirect to `/`.
- [ ] "Coming soon" page.
- [ ] Something else: ____

### Q3 — Which flags do we need at launch of approach A?

Minimum set based on current app:

- `link` — gates `/link`, API routes, nav.
- `craft` — gates `/craft`, API routes, nav.

Maybe-also:

- [ ] `combine` — switch Combine off globally (useful if a bug ships).
- [ ] `explore` — switch bowtie off (unlikely to need; it's the SEO story).
- [ ] `admin` — switch admin UI off (admin layout already role-gates; this is belt-and-braces).
- [ ] `signups` — close new sign-ups during an incident.
- [ ] Something else: ____

### Q4 — Flag visibility to the client

`NEXT_PUBLIC_*` env vars are inlined at build time into client bundles. Any flag whose value should stay server-only (e.g. gated admin features) must NOT be prefixed `NEXT_PUBLIC_`. Current proposal uses `NEXT_PUBLIC_FEATURE_LINK` because nav + routes are both client-rendered pieces of the gate.

- [ ] **OK — public is fine for `link`/`craft`.** They're routes anyone can type into the URL bar. *(leaning this way)*
- [ ] Keep flags server-only; nav gating happens via server-rendered conditional rendering only.
- [ ] Something else: ____

### Q5 — Rollout to Railway

When you flip `NEXT_PUBLIC_FEATURE_LINK=0`, Next.js needs a rebuild for the client bundle to pick it up. In Railway terms:

- [ ] **Change env var in Railway dashboard → Railway redeploys automatically.** *(default behaviour, simplest)*
- [ ] Trigger redeploy manually.
- [ ] Something else: ____

Note: once flags move to approach B (DB-backed), no redeploy needed.

---

## My recommendation summarized

Ship approach A today. ~150 lines. Flip `/link` and `/craft` off in production immediately. Promote to approach B when any of these happen:

- Someone else wants to flip a flag.
- You want to A/B without deploying.
- You want flags that can target specific users (first step toward C).

Keep the `isEnabled()` function stable from day one; it's the one call-site abstraction that makes the upgrade painless.
