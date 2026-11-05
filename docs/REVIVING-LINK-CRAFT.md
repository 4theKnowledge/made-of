# Reviving Link and Craft

**Status (2026-11-06):** Link (`/link`) and Craft (`/craft`) are hidden from the public site while the focus is on Combine. All code is preserved — only the entry points are closed off. This doc is the checklist for bringing them back.

## What was done to hide them

Grep for each item below to find the exact lines; the changes are small and reversible.

1. **Routes 404.** `src/app/link/page.tsx` and `src/app/craft/page.tsx` each have a `notFound()` call as the very first statement inside the page function (right after the signature). Everything below it is dead code that stays correct and type-checks.
2. **Nav hidden.** `src/components/common/Header.tsx` — `buildLinks()` no longer includes Link/Craft entries. The `Current` type still lists `"link"` and `"craft"` keys so legacy `current="link"` props on the page files don't break.
3. **Sitemap trimmed.** `src/app/sitemap.ts` — `/link` and `/craft` static routes removed.
4. **Robots disallow.** `src/app/robots.ts` — `/link` and `/craft` are in the `*` disallow list alongside `/api/` and `/admin/`.
5. **404 page shortcuts.** `src/app/not-found.tsx` — Link and Craft buttons removed from the "Or try a mode" section.
6. **About page mode grid.** `src/app/about/page.tsx` — the Link and Craft feature cards were removed. Combine was added alongside Explore.
7. **Pricing copy.** `src/app/pricing/page.tsx` — Free tier bullets and FAQ were rewritten around Combine. The "What happened to the Link and Craft modes?" FAQ item explicitly flags the pause and that the code is still in place.

## What was NOT touched (code preserved)

- `src/app/api/link/*` — all route handlers still work
- `src/app/api/craft/*` — all route handlers still work
- `src/graph/link*.ts`, `src/graph/link-puzzle.ts` — puzzle generation, BFS, hints, etc.
- `src/graph/craft.ts` — recipe resolution, cost calc, etc.
- `src/components/link/*` — LinkBoard, FreePlayShell, types
- `src/components/craft/*` — CraftBoard, types
- `src/[slug]/page.tsx` RESERVED set still contains `"link"`, `"craft"`, `"scratch"`, `"daily"` so item slugs can't collide with these paths even while hidden.

## To revive

Reverse each item above. A good order:

1. **Routes:** delete the `notFound()` call at the top of `src/app/link/page.tsx` and `src/app/craft/page.tsx`. The unused `notFound` import will fail lint — remove it too.
2. **Nav:** add the entries back to `buildLinks()` in `Header.tsx`:
   ```ts
   { href: "/link", label: "Link", key: "link" },
   { href: "/craft", label: "Craft", key: "craft" },
   ```
   Pick an order that fits the new pitch — probably after Combine, before Explore.
3. **Sitemap:** add the two static entries back to `sitemap.ts` (daily changeFrequency for /link, weekly for /craft, matching what was there).
4. **Robots:** remove `/link` and `/craft` from the `*` disallow in `robots.ts`.
5. **404 page:** add shortcut buttons back in `src/app/not-found.tsx` under "Or try a mode".
6. **About page:** add back the Link and Craft `<article className="feat">` cards in the `fgrid` section. The archived copy is reachable via `git log --all -- src/app/about/page.tsx` or by looking at the commit that hid them.
7. **Pricing page:** decide what the new tier structure looks like with three/four modes back in play. The archived educator-heavy copy still lives at `src/app/_pricing-archive/page.tsx` if you want a reference for the old "all four modes" framing.
8. **Reseed/verify:** `/link` serves a puzzle for the current UTC day via `generatePuzzle` (deterministic, no DB writes), so there's nothing to backfill. `/craft` reads live snapshot the same way Combine does. Hit both routes after reviving and make sure they render.

## Worth checking at revive time

- **Analytics taxonomy** in `docs/POSTHOG.md` includes `link_puzzle_*` and `craft_*` events. If the typed `track()` helper landed while these were hidden, those events need to be wired at the right call sites in `LinkBoard.tsx` and `CraftBoard.tsx`.
- **Progress table.** `progress` table stores Link/Craft completions under their respective `kind` values. Historical rows are still there — reviving shows them in `/account/stats` automatically.
- **Daily link puzzle is deterministic per UTC day** (seeded by `todayKeyUtc()`) so there's no "missed day" catch-up needed.
- **LinkBoard copy.** `src/components/link/LinkBoard.tsx:475-477` has a post-game nudge that currently says "Like Made Of? See what's free and what's coming" pointing at `/pricing`. If reviving changes the pitch, revisit that line.

## Why hidden rather than deleted

Keeping the code intact means revival is an afternoon of edits, not a rebuild. The cost is carrying some dead weight in the bundle (minor — these are server components with their own route segments) and a bit of grep noise. Delete only when you're confident they're not coming back.
