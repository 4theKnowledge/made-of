# Field Notes — Grouped for Review

Raw notes grouped by theme. Each item is tagged with:

- **Type**: `bug` · `fix` · `feature` · `design` · `research` · `question` · `decision`
- **Priority**: `P0` (broken/blocking) · `P1` (soon) · `P2` (nice) · `P3` (speculative)
- **Scope**: rough size (`S`/`M`/`L`/`XL`)
- **Status**: `open` — all are open; some are superseded by later notes (flagged)

Notes are ordered oldest → newest in the source, so later entries sometimes refine or contradict earlier ones. Where that happens, the earlier note is marked **(superseded)** and the current thinking lives in the later block.

---

## 1. Combine — Daily mode

The thinking here evolves significantly across the notes. Earlier entries treat Daily as "combine X things, in reasonable time." Later entries converge on a **manifest-based** design with bounded hop depth, and open the door to **levelled dailies** (easy/med/hard 1–10 cycling through the KB). Treat the last block as the current position.

### 1a. Design direction (current thinking)

- **`research` · P1 · L** — **Manifest-based daily (current proposal).** Daily has a manifest of N items. Each manifest item only pulls 1–2 hops of its inputs into the tile world. Bounded conceptual universe → easier to guarantee playability; doesn't block users from maxing collection.
- **`research` · P2 · L** — **Levelled dailies.** First daily = manifest size 1, then 2, … up to 10, across easy/med/hard buckets. Leaderboard score per difficulty/manifest size. Open question: with ~1000 KB items, loop ≈ 18 times (1000/55) — how do we keep this engaging as KB grows?
- **`decision` · P2** — **Daily leaderboard is optional.** Happy to drop it if the mechanic plays better without it. Goal is retention/delight, not competitiveness.
- **`research` · P2 · M** — **Sampling heuristic (alternative framing).** Sample two items at the same distance `m` from Big Bang; truncate tiles to those within `n` steps of the manifest. Reduces complexity, preserves natural exploration past `m`. *(Likely folds into the manifest approach above.)*

### 1b. Earlier daily ideas (partially superseded)

- **`research` · P2** — Daily should be "a few ages or less" recipes; takes hours currently — simulate to <30 min. **(superseded by manifest design)**
- **`research` · P3** — Daily as "combine X things" game mode; possibly **inverse scoring** (lowest score wins, like link pars). Keep as a later variant.
- **`feature` · P1 · M** — **Finds log / explorer-note / quest view** for Daily so users know what they need to find. Currently too easy (40-find game completable in 2 min).
- **`feature` · P1 · S** — **"Start Daily" dialog** so the timer starts there (not on first tile — users see the board before tapping). Timer runs until end dialog.
- **`feature` · P1 · S** — **Local-TZ daily rollover.** Release on UTC is sensible operationally but bad UX. Add countdown in "ready" and "game end" dialogs until next daily.
- **`question` · P2** — Does updating themes invalidate user games? Needs an answer / test.

### 1c. Daily playtest bugs

- **`bug` · P1 · S** — Game-end dialog style broken.
- **`fix` · P2 · S** — "Used stuff" badge truncates — make it nicer.
- **`feature` · P2 · S** — Show time taken in end-of-game.

---

## 2. Combine — Endless / core playability

### 2a. Dealer & difficulty (biggest open design question)

- **`research` · P0 · XL** — **Does the endless dealer push toward undiscovered items?** Current suspicion: it over-guarantees and users get stuck in local mining loops (seen in sims). Proposal: down-weight in-game finds by their *recipe-tree creatability probability*, propagated through their recipes, so expected-new-chain probability is maximised. Everything starts at a nominal probability. **Needs a simulator.**
- **`research` · P1 · M** — **Bands aren't ages — they're discovery difficulty** (likelihood of finding). Reframe UI/copy accordingly.
- **`research` · P1 · M** — **Cumulative attempts as a difficulty metric.** Use in sim / dealer tuning.
- **`bug` · P1 · S** — Sun is being dealt and doesn't leave.

### 2b. Playability philosophy

- **`research` · P1 · L** — **Hypercasual target.** One-handed, zero-experience onboarding, simple gameplay loop. Combine *should* already be one-hand playable — verify.
- **`research` · P1 · L** — **Is the gameplay loop too long?** Consider reframing as "explorer trying to find things in automatically curated themes."
- **`research` · P1 · M** — How do other games keep this fresh? Intermediary goals? Known fun states? **Prefer deriving fun from game state over adding new helpers/features.**
- **`feature` · P2 · M** — **Visual progression / map** with stateful progress for retention.

### 2c. Known Combine bugs/fixes

- **`fix` · P0 · M** — When a dropped tile lands between **multiple** possible recipes, throw a distinct decision dialog (different from the normal recipe-selection toast).
- **`bug` · P1 · S** — Hold tray: can't click to select like the normal tray.
- **`fix` · P2 · S** — Toasts still show `+` inside badges.
- **`feature` · P2 · S** — Show **top 3 most-used tiles** at end-of-game for all modes.
- **`feature` · P2 · S** — In collection UI, mark items as "found this round" for new finds.

---

## 3. Themes & collections

### 3a. Collection semantics (needs a clear model)

- **`design` · P1 · M** — **Make the collection model obvious to users.** Daily collection ≠ endless collection. Need a name for the non-daily (endless?) collection and clear copy that collections only show what's in the current theme.
- **`question` · P2** — Should collections be tied to themes (e.g., "complete the Beginner collection")? **Current lean: probably not** — but a milestone/badge for "collected everything in theme X" that **persists even if the theme is removed** could work.
- **`feature` · P2 · M** — Add collections to the account page so users see game progress. Improve the stats component into actual pages.

### 3b. Theme content ideas

- **`feature` · P2 · S** — **Beginner theme** with limited recipes/collection.
- **`feature` · P2 · S** — **Food theme**: milk, cheese, pasta, …
- **`feature` · P2 · M** — **Mammals theme**; missing items to add: cow, duck, goat, rabbit, dog, cat, horse, rooster, turkey, donkey. (Horse listed twice in source.)
- **`research` · P3 · S** — Proof-of-concept for themes to boost playability. Keep "Everything" as the baseline.

### 3c. Admin — theme editor bugs

- **`bug` · P1 · M** — **Auto-settings don't prune.** When auto settings (e.g., depth) change, previously auto-added items aren't pruned. Need to distinguish *chain-added* vs *manually-added* items. Add tests.
- **`bug` · P1 · S** — Theme editor doesn't live-update when items are selected — stuck on "Add items to publish" until manual refresh.
- **`fix` · P1 · S** — `"Save failed: 1 player will drop below 100% on this theme. Pass {force:true} to proceed."` — this guard should default to `force: true`.
- **`fix` · P2 · S** — Admin actions need loading indicators — hard to tell when an action is in flight.

---

## 4. KB / content model

- **`decision` · P1 · S** — **Tool-mediated recipes.** Prefer `rock + pick → mine`, `wood + saw → plank`, `plank + nail → table`, `thread + knitting needles → sweater` — not shortcut recipes that skip the tool. Audit existing recipes.
- **`feature` · P2 · S** — Add `CO2 + H2O → soda water`.
- **`feature` · P2 · S** — Alternative simple recipe: `rock → road`.
- **`feature` · P2 · M** — **Per-item stats** (times made, etc.). Feed into user titles like "Master of Fish" shown on leaderboard. Config lives in KB admin.

---

## 5. Cross-app / strategy

- **`decision` · P1 · L** — **Go all-in on Combine.** Other modes reveal recipes — hide recipes elsewhere; show just part count via "mystery boxes." Users log in to see unlocked recipes. Treat as a **global app-wide decision** — affects Explore, Daily-link, Craft.
- **`feature` · P2 · M** — User **sub type** on account to align with the pricing page.

---

## 6. Growth, sharing, onboarding

- **`feature` · P1 · M** — **Guided tutorial** (`mode = 'tutorial'`?). Logged-out users get prompted every session (annoying by design — reason to sign up). Flag on user hides it after completion.
- **`feature` · P2 · S** — **Share preview** for games — test it.
- **`feature` · P2 · S** — **Share without finishing** (move into "more" menu); "Invite friends" surface.
- **`feature` · P1 · S** — **Admin tool to generate beta invite links** to share.
- **`design` · P2 · S** — Turn "How to play" into a carousel.

---

## 7. Polish / UI

- **`fix` · P2 · S** — Audio still unreliable on Safari — improve.
- **`design` · P2 · S** — Move the "more" menu next to the helper button, on the same row as the hold tray.

---

## Suggested triage next steps

1. **File P0 bugs as pm tasks** — they're silently breaking flows (rank/leaderboard, theme create/delete, admin tree search crash, multi-recipe drop, Sun stuck).
2. **Pick one direction for Daily** (manifest vs. levelled vs. keep current) before building more around it — most of §1 is blocked on that decision.
3. **Build the Combine simulator** (§2a) before more dealer tweaks — the dealer-quality question is the biggest lever on retention and currently unmeasured.
4. **Nail the collection model** (§3a) — several bugs and UX notes cascade from the daily-vs-endless scope split not being legible to players.
5. **Decide on the "all-in on Combine / hide recipes elsewhere" strategic bet** (§5) — it reframes a lot of the other modes and should happen before investing more in Explore/Craft polish.
