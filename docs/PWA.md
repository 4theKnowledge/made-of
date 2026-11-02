# PWA scope

Making Made Of a Progressive Web App — installable, offline-tolerant, mobile-friendly without a native app.

## Why PWA before Flutter

- Keeps one codebase (Next.js) instead of running Flutter alongside.
- Gets ~80% of a native app's mobile wins: install to home screen, standalone shell, offline, push (iOS 16.4+).
- Doesn't risk the SEO story — item pages stay server-rendered HTML.
- Tests mobile appetite before investing in a cross-platform runtime.

What a PWA *can't* match a native app on: App Store ranking, in-app purchase revenue share, deep OS integrations (widgets, Shortcuts, Live Activities), 60fps game animation on Android low-end.

## Current state

- No manifest.
- No service worker.
- No iOS meta tags.
- `src/app/layout.tsx` has viewport + theme-color only.
- `apple-icon.tsx` and `icon.svg` exist; no raster PNG icons at 192 / 512.

## Pieces to build

### 1. Web app manifest

A `src/app/manifest.ts` route (Next.js 15 typed manifest). Shape:

- `name`, `short_name`, `description`.
- `start_url` — see Q4.
- `display: "standalone"` so launched from home screen it looks like an app.
- `theme_color` matching the ink colour, `background_color` matching the paper.
- `icons[]` at 192 and 512, plus a maskable 512 (safe zone padded).
- `shortcuts[]` — optional quick actions on long-press (e.g. "Today's daily", "Combine").

### 2. Icons

- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `public/icons/icon-maskable-512.png` (with ~20% safe-zone padding so iOS/Android rounded-rect crops don't eat the logo)

The existing `icon.svg` can be the source; we rasterise at build time or ship fixed PNGs. Fixed PNGs are simpler.

### 3. Service worker

A `public/sw.js` (hand-rolled). ~100 lines. Responsibilities:

- Install: precache the shell (offline page, core CSS, fonts).
- Activate: clean up old caches.
- Fetch: route-aware strategy table — see "Caching strategy" below.
- Message: handle `SKIP_WAITING` so new deploys apply on reload.

### 4. Service worker registration

Client component `ServiceWorkerRegistration.tsx` imported once in `layout.tsx`. Registers `/sw.js` on mount, listens for updates, prompts for refresh when a new SW is waiting.

### 5. Install prompt

- Non-iOS: stash `beforeinstallprompt`, show a styled banner at the right moment (Q3), fire the stored prompt when they tap Install. Dismiss-forever cookie.
- iOS: no `beforeinstallprompt` event. Show an iOS-specific hint explaining "Share → Add to Home Screen" with the Share icon inline.

### 6. iOS meta tags in layout.tsx

```html
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Made Of" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />
```

### 7. Offline fallback page

`src/app/offline/page.tsx` — the page the SW serves when network + cache both miss. Shows:
- "You're offline" header.
- If a daily puzzle is cached, deep-link into it.
- Link to installed Combine / Craft (which may or may not work depending on Q2).

### 8. Daily offline support

See Q2. If enabled:
- SW caches `GET /api/link` responses for 24h keyed by date.
- Moves posted while offline queue in localStorage.
- Client flushes queue on `window.online` event.
- Server deduplicates idempotently via a client-generated move id.

## Caching strategy

| Route pattern | Strategy | Notes |
| --- | --- | --- |
| `/`, `/i/[slug]`, `/explore/[slug]`, `/craft`, `/combine`, `/link`, `/account` | Network-first, cache fallback, 24h | The HTML shell |
| `/pricing`, `/about`, `/privacy`, `/terms`, `/method` | Stale-while-revalidate | Rarely change |
| `/admin/*` | Never cache | Auth-gated |
| `/api/*` (default) | Never cache | All marked `dynamic = "force-dynamic"` |
| `GET /api/link` (daily) | Cache 24h | Special-case for offline play |
| Static assets (CSS, fonts, icons, OG images) | Cache-first, 30d | Content-hashed in Next.js build |
| `/offline` fallback | Precache on install | Never evicted |

## What's deferred

- **Push notifications.** iOS 16.4+ only. Needs permission flow, SW `push` listener, server-side VAPID keys, subscription storage. Separate PR after basic PWA ships.
- **Background sync.** The `window.online` queue flush is simpler and covers 90% of cases.
- **Combine / Craft offline.** Both make API calls per move. Daily is the only mode naturally offline. Would need snapshot shipping to the client — violates the "never send the whole graph" hard rule.
- **Widgets / Live Activities / Shortcuts.** Native-only.

## File list

```
public/sw.js                                      new, ~100 lines
public/icons/icon-192.png                          new
public/icons/icon-512.png                          new
public/icons/icon-maskable-512.png                 new
src/app/manifest.ts                                new, ~40 lines
src/app/offline/page.tsx                           new, ~50 lines
src/components/common/InstallPrompt.tsx            new, ~120 lines
src/components/common/ServiceWorkerRegistration.tsx new, ~50 lines
src/lib/offline-queue.ts                           new, ~60 lines (if Q2 includes daily)
src/app/layout.tsx                                 edit — iOS meta, register SW
src/app/[relevant pages].tsx                       edit — install prompt mount points
```

Total: roughly 500 new lines + small edits. Realistic in a day of focused work.

## Open questions

### Q1 — Hand-rolled service worker, or library?

- [ ] **Hand-rolled, ~100 lines.** Full control. Easy to reason about when it misbehaves. No new deps. More to write up front, less to maintain. *(leaning this way)*
- [ ] **`@serwist/next`** (Workbox-based). Generates SW via build tooling. Fewer hand-written lines. Build-time precache manifest. More build-time magic to debug.
- [ ] Something else: ____

**My take:** hand-rolled. Caching rules for this app are specific enough (never cache admin, never cache paid-tier `everything`, special-case the daily) that a config-driven generator fights more than it helps.

### Q2 — Offline scope

- [ ] **Daily puzzle only + fallback page.** Today's puzzle plays offline once loaded; moves queue and drain on reconnect. Any other page offline shows the fallback. *(leaning this way)*
- [ ] **Daily + last-viewed item page + fallback.** Also cache the item page you were on. Useful for "I was reading about pencils on the subway." Extra complexity but gives Explore an offline story.
- [ ] **Just a fallback page, no real offline play.** Shows a nice offline screen. Daily won't work without network. Minimum viable PWA.
- [ ] Something else: ____

**My take:** Daily only. Daily is the hook. Item pages offline is a nice-to-have I'd ship as a follow-up if people ask.

### Q3 — When does the install prompt appear?

- [ ] **After the Daily is solved + persistent footer link.** High-intent moment — they finished the puzzle. Won't nag. Footer link so dismissers can still install. *(leaning this way)*
- [ ] **First visit, dismissible.** More installs, but feels pushy. Dismiss-forever cookie to avoid re-nagging.
- [ ] **Footer link only, no banner.** Minimal. Install discovery is lower but no annoyance risk.
- [ ] Something else: ____

**My take:** post-daily. First-visit banners are a dark pattern for an app the user hasn't tried yet. Let them hit a dopamine moment, then offer.

### Q4 — Start URL when installed?

- [ ] **`/` (home — daily puzzle).** Matches "opens the game" expectation. Daily is the hook. *(leaning this way)*
- [ ] **`/combine`.** If you believe Combine is the sticky mode and daily is just the Trojan horse.
- [ ] **`/explore`.** Encyclopedia-first framing. Not currently a route — `/explore/[slug]` is.
- [ ] Something else: ____

### Q5 — Install prompt copy

What should the banner say? Default I'd use:

> **Install Made Of**
> One tap and the daily puzzle lives on your home screen. Plays offline.
>
> [Install] [Not now]

Alternatives:
- [ ] Keep the default
- [ ] Lead with Combine: "Install for daily puzzles, Combine, and offline play"
- [ ] Lead with offline: "Install so Made Of works offline — anywhere, any time"
- [ ] Something else: ____

### Q6 — Shortcuts (long-press on installed app icon)?

- [ ] **Yes:** "Today's daily", "Play Combine", "What is anything made of" (search)
- [ ] **Just daily + Combine.** Fewest moving parts.
- [ ] **No shortcuts.** Keep it minimal.
- [ ] Something else: ____

### Q7 — iOS Add-to-Home-Screen hint

iOS doesn't fire `beforeinstallprompt`. Options for prompting Safari users:

- [ ] **Detect iOS Safari standalone-mode-off, show a one-time banner** with the Share icon illustration and three-step instructions.
- [ ] **Only show it after they dismiss the native install prompt** (which doesn't fire on iOS — so this effectively never shows the hint; wrong).
- [ ] **Skip iOS install hinting.** They can find Share → Add to Home Screen themselves or we never bother.
- [ ] Something else: ____

**My take:** show the hint. iOS is the more valuable platform for Made Of's audience; it's worth the extra 30 lines.

### Q8 — Theme color

Current `layout.tsx` has `themeColor: "#101014"` (dark ink). PWA theme color is what the OS uses to tint the title bar when installed. Options:

- [ ] **Keep `#101014`** — matches the dark theme.
- [ ] **Match system theme** — use a media query so light-mode users get a light title bar. Needs two `themeColor` values in viewport.
- [ ] Something else: ____

### Q9 — Should the Daily moves offline queue dedupe on the server?

If a user plays offline, moves queue locally, flush later. If their device sends twice (bad network, retry), the server shouldn't double-record the move.

- [ ] **Yes, client sends a `moveId` UUID; server idempotent on that.** Adds a `move_id` column to the daily attempts table (if there is one) or dedupes by `(user, puzzle, moveId)`. *(right call for correctness)*
- [ ] **No, best-effort.** Simpler. Rare dupes OK for a game.
- [ ] Something else: ____

**My take:** yes, idempotent. One migration + a hash check on write. Cheap insurance.

---

## Scope summary

If you take my leaning answers:

**Minimum PWA (ships in a day):**
- Manifest + icons + iOS meta.
- Hand-rolled SW with static-asset caching + offline fallback.
- Install prompt post-daily + footer link.
- No offline Daily play yet.

**Add offline Daily (second day):**
- Cache `/api/link` 24h.
- Offline move queue in localStorage.
- Idempotency on the server.

**Follow-up PRs (not scoped here):**
- Push notifications.
- Item-page offline caching.
- Background sync for other modes.
