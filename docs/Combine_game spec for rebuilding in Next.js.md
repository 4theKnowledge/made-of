# Combine — game spec for rebuilding in Next.js

Nov 1, 2026 · @Tyler

## Overview

Combine is an endless puzzle mode: you place tiles on a small grid, and touching tiles that make up a real recipe from the knowledge base combine into what they make. The board filling up ends the game. This doc is the full rule set and the exact numbers from the working prototype (`made-of.html`, v55), so it can be rebuilt in the Next.js app and play the same.

**Core loop**

1. You get three tiles in a tray. Place each one on an empty square, or drop it on top of a tile.
2. Any edge-connected group of tiles that holds exactly one recipe's ingredients combines into the thing it makes. All the ingredients are used up.
3. The new thing may combine again with its neighbours (a chain). Finished things that nothing else uses fly to a shelf.
4. When the tray is empty, three new tiles are dealt. Every new tray is guaranteed to have a move within one or two plays.
5. Making things moves you up through ages, from raw stuff to refined goods. Tiles that nothing nearby can use any more crumble away.
6. The game ends when the board has no empty square left.

**Design principles**

- Real knowledge, not invented recipes. Every combine is a recipe from the Made Of knowledge base, and every card teaches a fact.
- Physical things only. Energy, events and networks (sunlight, electricity, fire, the internet) are not items.
- Discovery is earned. Combos only glow once you have found them; new ones are found by trying things.
- Always a way forward. Dealt trays are checked for a move; a hint always gives something.
- The board stays coherent. Ages keep tiles within a step or two of refinement, and crumbling clears what no longer fits.

**What the play-test showed** (two players, several hours): the loop holds. Players did the daily, then kept going on endless. Big group combines on a nearly full board were the favourite moment. The collection book worked like a Pokédex. Players competed on the daily and compared endless scores.

## Data model

Combine reads the same knowledge base as the rest of the app. Recipes for each theme are derived from it at load time by a fixed set of filters, so new items join Combine automatically.

**Item fields used by Combine**

| Field | Example | Use in Combine |
| --- | --- | --- |
| id | `olive oil` | Tile name and key |
| tier | F, N, M, C, P, S | Tile colour, score value, fallback refinement level |
| kind | food, tool, living, energy… | Filters (living outputs are skipped in Everyday) |
| recipes\[\] | `{f:[olives], w:[press], n:[], e:[]}` | `f` = made from, `w` = made with (tools), `n` = needs (ignored by Combine) |
| fact | one or two sentences | Discovery card and detail card |
| icon | pictogram key or element symbol | Tile art |

Tier values for scoring: F 1, N 1, M 2, C 3, P 4, S 5. Tier fills: F `#C9B8F5`, N `#B5DDA4`, M `#F5C96B`, C `#9ED9D5`, P `#F4A38C`, S `#A9B8E8`.

**Physical things only (applies to the whole app, not just Combine)**

When the knowledge base is parsed, these items are dropped everywhere: `sunlight`, `lightning`, `electricity`, `internet`, `fire`.

- Any recipe that mentioned one of them just loses that mention (in `f`, `w`, `n`, `e` and in links). Sea salt becomes "from seawater".
- A recipe left with nothing in it is removed. If an item's recipes become identical after stripping, the duplicates collapse into one, and a lone remaining recipe loses its label (an oven's "electric" and "wood-fired" versions merge).
- `ash` is made from wood + air (burning), not from fire.
- The `big bang` stays as the single non-physical exception: it is the origin for From scratch and for Explore's chains. Combine excludes it.
- Places (house, farm, factory, city, road, garden, power plant) are kept: they are physical, just not hand-held. An open question for later.

**Left out of Combine (stays in Explore and Daily link)**

The semiconductor fab chain is excluded from both Combine themes, as outputs and as ingredients: boron, fluorine, argon, neon, chromium, cobalt, zirconium, hafnium, molybdenum, tantalum, tungsten, high-purity quartz, fluorite, phosphate rock, borax, tungsten ore, molybdenite, zircon, cobalt ore, coltan, chromite, metallurgical silicon, hydrogen gas, chlorine gas, hydrogen chloride, trichlorosilane, polysilicon, argon gas, neon gas, fluorine gas, sulfuric acid, hydrofluoric acid, etching gas, dopant gases, silicon ingot, polishing slurry, synthetic diamond, ultrapure water, solvent, photoresist, fused silica, photomask, refined copper, tantalum metal, cobalt metal, tungsten metal, molybdenum metal, hafnium oxide, ABF film, transistor layer, finished wafer, die, package substrate, quartz crucible, EUV mirror, CO2 laser, argon fluoride laser, arc furnace, siemens reactor, czochralski puller, air separation unit, wire saw, dicing saw, diamond press, electron beam writer, ion implanter, plasma etcher, lithography scanner, chemical plant, packaging plant, silicon wafer, chip fab, microchip, circuit board. Things that need a microchip (laptop, smartphone) can't be made in Combine for now.

**Themes and how each recipe set is built**

| Theme | Ages | Things to make | Rule |
| --- | --- | --- | --- |
| Everyday | Gathering, Kitchen, Workshop, Home, Finishing | 143 | Output in the Everyday set and not `living`; every ingredient is in the Everyday set, or tier N, or kind `tool` |
| Everything | Beginnings, Earth, Craft, Industry, Machines, Modern | 203 | Any item, any ingredients |

Rules that apply to both themes, for each recipe of each item:

1. Ingredients = unique `f` + `w` (both are consumed in Combine; "made with" is kept only for display).
2. Keep the recipe only if it has 2 to 7 ingredients, does not contain its own output, and touches nothing excluded.
3. Index recipes by ingredient for fast matching, biggest recipes first.
4. Group recipes that share exactly the same ingredient set (sorted and joined), so the player can choose between them.
5. Derived sets: outputs, ingredients, base (ingredients nothing makes), mid (ingredients that are also outputs), tools (anything used as `w`), terminal (outputs that are no one's ingredient, the "finished things").

**The Everyday set** is the app's everyday list, plus the 128 everyday items added for Combine (food and drink, home and craft, play and paper, kitchen tools; a full list lives in the data file), plus these basics: steel, plastic, copper wire, electric motor, wood, tin, sulfur, water, bacteria, leaf litter, air. Ids missing from the knowledge base are dropped silently.

## Board and turn rules

A turn is placing one tray tile. Everything combines through one rule: an edge-connected group holding exactly one recipe's ingredients.

&#91;embedded content: turn flow · 2 decisions, 1 loop\]

A chain loops back through the same recipe check with a higher multiplier; everything ends in the after-turn step (helpers skip it).

**Board and tray**

- Board: 5×5 on phones (viewport width 600 px or less), 6×6 on larger screens. The daily game is always 5×5. The size is fixed when a game starts and saved with it.
- Seed tiles at the start: 6×6 uses squares 7, 10, 19, 25, 28; 5×5 uses 6, 8, 16, 18. Everyday seeds with sheep, wheat, clay, milk, cotton plant (those in the first age); otherwise random base tiles from the first age (not tools). A seed is skipped if it would already combine.
- Tray: three tiles. Used tiles leave empty slots; new tiles come only when all three are used (or on Swap).
- Neighbours are the four edge-adjacent squares (no diagonals).

**Placing on an empty square**

1. The tile goes on the square, +1 point, the move counter goes up.
2. Matching runs from that square (below). If a recipe matches, it resolves.
3. After the move: age check, then crumbling (see Ages). Then deal if the tray is empty, then game over if no empty square is left.

**Matching: any shape of touching tiles**

For the placed item x at square i, try each recipe containing x, biggest first. Grow a group outward from i: repeatedly add any neighbour of the group whose item is still needed, one copy per ingredient, depth-first with backtracking. The first recipe whose needs are all met wins. Lines, Ls, zig-zags and 3×3 blocks all count; one tile out of contact breaks it. Tiles that are resting are skipped (not used in the current build).

**Dropping on top of a tile**

- Dropping x onto a square holding y: try recipes containing both x and y (x ≠ y), biggest first, growing the rest of the group from y's square.
- On a match, x is never placed; the group, including y, resolves at y's square.
- No match: the tile goes back to the tray, the target shakes with a "no recipe" label, nothing is spent and it is not a turn.

**Choosing between results**

- When the matched ingredient set makes more than one thing (steel + wood: saw, wheel, press, hammer), the move pauses with a picker over the board: "These make more than one thing. Pick one".
- Found things show icon and name first; unfound ones show as "? Something new" without the name. Picking one makes it.
- Only the player's own move asks. Chain steps pick by themselves: a random unfound option if any, else a random option (seeded RNG).
- Everyday has 9 such sets, Everything 14.

**Resolving a combine**

1. The group glows for 300 ms.
2. Every ingredient tile is removed (tools too; "made with" is not kept).
3. The new item lands on one of the freed squares: the placed square first, preferring a square where the new item would combine again.
4. Score it, count it toward the age, record the recipe, and show a discovery card if it is a first.
5. If it is a finished thing (terminal), it ships: it flies to the shelf with a bonus and the square empties.
6. Otherwise matching runs again from its square at chain multiplier +1, so cascades happen by themselves.

**Shelf**

A strip above the board holding every finished thing made this game, grouped with a count badge (like captured chess pieces). Tap one for its detail card.

**Game over**

When no empty square remains after a move. The summary shows score and best, things finished, age reached, new discoveries (first 10, then "+N more in your collection"), the shelf, progress ("43 of 143 discovered in Everyday"), Theme and Collection buttons, and Play again (or "Play endless" after a daily) plus Share.

## Dealing

Every new tray is checked before it is dealt, Block Blast style: about 3 in 4 trays have a tile that combines straight away, and the rest need one set-up move. In simulation over 98% of trays met this; the misses were on nearly full boards.

**Picking one tile** (all from the current age's deal set, see Ages)

A tool is only dealt if that tool is not already on the board or in the tray and fewer than 4 tools are on the board. Then one roll r in \[0, 1):

| Roll | Pick |
| --- | --- |
| 0.45–0.60, if some non-tool item has 2+ copies on the board | A partner for the most-piled item (another ingredient of a recipe that uses it) |
| under 0.45 | Any ingredient that would combine right now on some empty square |
| under 0.80 | A missing ingredient of any recipe that already has a piece on the board |
| under 0.88 | A made thing from this age (a mid item), to start a chain |
| otherwise | A raw base item; 25% of the time tools are allowed in this pool |

Each step falls through to the next when it has no candidates.

**Building a tray (the guarantee)**

- One play: some tray tile combines on an empty square, or onto a tile.
- Two plays: placing tray tile A on an empty square, then tray tile B on a square next to it, makes something.
- Decide up front: want a one-play tray with probability 0.75.
- Up to 60 attempts of three picks. For the first 40, skip trays with a repeated tile. Accept a one-play tray when wanted, or after attempt 30 regardless. A two-play tray is accepted at once when a one-play one isn't wanted, otherwise kept as a fallback.
- After 60 attempts: use the fallback. Failing that, hand over both halves of a random two-ingredient recipe from the current age plus one pick.

**Randomness**

Every game carries its own random state (`rs`, a 32-bit int) and all game randomness uses it (mulberry32), so a saved game resumes exactly and the daily game is identical for everyone. Endless seeds it randomly; the daily seeds it with an FNV-1a hash of `madeof:combine:` + the local date (YYYY-MM-DD). Visual and audio randomness uses `Math.random`.

## Ages and crumbling

Ages keep the board coherent: tiles are only dealt for recipes in the current age and the one before, so the board holds things within a step or two of refinement. Crumbling removes what nothing nearby can use any more.

**1. How refined is a thing (whole knowledge base)**

`refine(x)`: 0 for tier F or N, or anything with no recipe. Otherwise 1 + the smallest, over its recipes, of the largest `refine` among that recipe's `f` + `w` parts (not itself). Compute by repeated relaxation: a strict pass (a recipe counts only once all its parts are known), then a loose pass that ignores unknown parts, which breaks loops such as steel needing a furnace that needs steel.

**2. Recipe levels inside a theme**

- Start every theme output at infinity, and every ingredient the theme doesn't make at `refine(x)` (so glass and copper wire, which Everyday doesn't make, still count as refined).
- A recipe's level = 1 + the highest level among all its ingredients, tools included (bread needs an oven, an oven needs bricks).
- Relax outputs to their lowest recipe level, strict then loose, as above.

**3. Cutting levels into ages**

1. Sort all recipe levels. With n ages, cut points are the levels at positions len × b / n for b = 1 to n−1.
2. A recipe's age = 1 + the number of cut points below its level, capped at n. Equal levels always share an age.
3. Then, for up to 10 passes: if an ingredient is made only in a later age than this recipe, move the recipe to that age. Nothing in an age needs a part from a later age.

**4. What is in play in age k**

| Set | Recipes it comes from | Used for |
| --- | --- | --- |
| Deal set | ages k−1 and k | Every tile dealt (base = raw ones, mid = made ones) |
| Useful set | ages k−1, k and k+1 | Tiles in here never crumble |

Raw basics such as water show up in every age because later recipes still use them.

**5. Moving up**

- Every combine fills the age bar, including chain steps and auto choices.
- Leaving age a (0-based) needs 6 + 2a makes: 6, 8, 10, 12…
- On a new age: bar resets, +100 × new age index points, +1 Move helper, a "New age" card listing up to four things from that age, a fanfare and a vibration. The last age has no bar ("Final age").
- The age bar above the shelf reads "Age 2 Earth ━━─ 3/8 → Craft".

**6. Crumbling**

- After every turn (not after helper moves), each board tile outside the useful set gets one crumble tick. The count is per square and resets when the tile there changes or becomes useful again.
- On the 4th tick it crumbles: a 450 ms fall-and-fade animation, a sandy whoosh, and the square empties. No points.
- Crumbling tiles turn grey with diagonal stripes and a red badge counting 3, 2, 1. Their label says "crumbling: nothing in this age uses it, gone in N turns".
- Most crumbling happens right after an age-up, when things from two ages back stop being useful.

## Scoring

Points reward refinement, bigger groups, chains and clutch plays. `tier` = the made item's tier value (F 1, N 1, M 2, C 3, P 4, S 5); `chain` = 1 for your own move, +1 for each automatic step after it; `n` = ingredients in the recipe.

| Event | Points |
| --- | --- |
| Place a tray tile | +1 |
| Combine | round(20 × tier × chain × (1 + 0.5 × (n − 2))) |
| Finished thing ships to the shelf | round(40 × tier × chain) on top |
| Reach a new age | 100 × new age index (1 for Age 2, 2 for Age 3…) |
| Close call | round(30 × tiles cleared × (1 + (fullness − 0.8) × 5)) on top |

- A close call is a combine that clears 3 or more tiles while the board was at least 80% full just before it. It shows a "Close call! +X" badge with the discovery chime and a vibration, and is counted per game.
- A chain shows a "×2 chain" badge beside the score.
- Best score is kept per theme; the daily has its own result.

Example: concrete (tier M, 4 ingredients) as your own move = 20 × 2 × 1 × 2 = 80.

## Discovery and hints

Nothing glows until you have made it once, so new combos are found by trying things; after that, the game helps you repeat them.

**Discovery**

- "Found" is per player, across games and themes. The first time anything is made, it is found: a discovery card shows the item, the exact recipe used as icon chips ("Cow + Water = Glue") and the item's fact. It stays about 4.6 s; tap to close. A short chord plays.
- The recipe used is remembered per item (latest one wins) and shown later as "How you made it".
- The date of the first find is recorded for the collection book.

**Glows while holding a tile** (only for results you have found)

- Empty squares where it would combine show a faint picture of the result, outlined in the accent colour.
- Board tiles you could drop it onto get an accent ring.
- If the set makes several things, the faint picture shows a found one, with a small "+N" for the others.
- With nothing found yet, the tip reads "Nothing glows until you've found it. Drop it on, or beside, things that might go with it."

**Hint** (always gives something and always costs one)

Asking must never reveal for free that nothing is possible, so a hint works down this list and uses the first that exists:

1. A new combo in one play: the tile is selected and its square shows a pulsing "?" (or a ring on the tile to drop onto).
2. A new combo in two plays: the first square shows "?", and the tip says which tile to put next to it.
3. A combo you already know that works right now: the tile is selected and the usual glows show where.
4. Nothing on the board works: a card teaches a recipe from the current age that uses one of your tiles (unfound ones preferred), "Nothing fits right now. Try this: Cement + Sand + Gravel + Water = Concrete". It stays 9 s.

A set counts as new if any of its possible results is unfound. The hint is refunded only if even step 4 finds nothing.

**Detail card** (tap a board tile with nothing selected, tap a shelf or collection item, or press and hold a tray tile for 450 ms)

Shows the pictogram and name, then the catalogue line ("No. 004 · unearthed October 28, 2026"), then one of:

- "How you made it" with your remembered recipe,
- "Out in the world it's made from" with its knowledge-base recipe, or
- "A raw thing".

Then the fact, then "Goes into": recipes in this theme that use it, with found results named and the rest as "+3 to discover". Buttons: "Full story in Explore" (opens the item's Explore page) and "Back to the game".

## Helpers

Four limited helpers sit behind one **Helpers** button in the top row. Its badge shows the total uses left; tapping it opens a menu with each helper, a one-line description and its count. Picking one closes the menu and starts it.

| Helper | Uses per game | What it does | Is it a turn? |
| --- | --- | --- | --- |
| Hint | 2 | See Discovery and hints | No |
| Move | 2, +1 per new age | Pick a tile on the board, then tap an empty square or a tile. It combines at its destination like a placement (groups, drop-on-top, choice, chains). A failed move onto a tile bounces with "no recipe" and costs nothing. A crumbling tile keeps its countdown. | No: nothing crumbles, nothing is dealt, the tray is unchanged |
| Swap | 2 | Replace the tray with three newly dealt tiles (guarantee applies) | No |
| Clear | 1 | Tap a board tile to remove it | No |

- While Move or Clear is active, the Helpers button becomes **Cancel**, the tip explains the next tap, and the menu stays shut. Movable tiles get a dashed outline; the picked tile lifts. Tapping the picked tile again lets you pick another. Escape cancels.
- While a tile is picked up for Move, the glows show where it would make something you have found (computed with the tile lifted off its square).
- Picking a tray tile cancels Move. The menu closes on any tap outside it.
- The daily game gets the same helper counts for everyone.

## Daily game, saving and persistence

The daily game is the same start for everyone, one go per day; endless games save after every move. In the prototype everything lives in the browser's localStorage; in the real app, progress should move to the player's account.

**Daily game**

- Everyday theme, 5×5 on every device, standard helper counts, seed from the local date (see Dealing). Players see the same seeds and the same first tray; their tiles stay identical while they place the same way, then diverge as the dealer adapts to each board.
- It sits at the top of the theme menu under **Today**. Once finished, that slot shows "Daily game · done", the score and age, and a **Share result** button; it can't be replayed.
- The result is stored as `{key, score, age, ageName, made, top}`, where `top` is the highest-tier item on the shelf.
- Share text:

```
Made Of · Daily Combine 2026-10-31
🟩🟩🟩⬜⬜ reached Workshop
2,840 points · 23 made · best: soap
<app url>#combine
```

One square per Everyday age, green up to the age reached.

- The endless share text: `Made Of · Combine (Everyday)`, then `N points · reached the X age · N finished things · longest chain ×N · N new discoveries`, then the URL. Share uses the native share sheet where available, else the clipboard.

**Saving**

- Two save slots: one endless game (it records its theme) and one daily game. Saved on every render while nothing is animating.
- Saved fields: theme, daily, n (board size), rs (random state), board, tray, score, made, longest, found (this game's new finds), swaps, clears, hints, mv, over, moves, shelf, age, ageMade, crumb, newBest, closeCalls.
- A save is ignored if: its theme is unknown, it is a daily from another day, it is a finished endless game, or any tile on its board or tray no longer exists in the knowledge base.
- Switching between daily and endless, or between themes, saves the current game first and resumes the other slot if it matches; otherwise a new game starts.

**Storage keys (prototype)**

| Key | Holds |
| --- | --- |
| `madeof:cbsave`, `madeof:cbsave:daily` | The two game saves |
| `madeof:cbdaily` | Today's daily result |
| `madeof:cbfound` | Every item ever found in Combine |
| `madeof:cbhow` | The recipe last used to make each item |
| `madeof:cbwhen` | Timestamp of each first find |
| `madeof:cbbest`, `madeof:cbbest:everything` | Best score per theme |
| `madeof:cbtheme` | Last endless theme |
| `madeof:music`, `madeof:sfx`, `madeof:vol` | Sound settings (`madeof:sound` is a legacy on/off, migrated) |

## Collection book

The book is a dig log of everything the current theme can make, grouped by age, like a Pokédex. It opens from the book icon in the age row and from the game-over card.

- Header: "Collection · Everyday", a big "43 of 143", a progress bar, and a dig line: "First find Oct 28 · latest Concrete, Oct 31 · 3 days digging" (only dated finds count).
- One section per age with its own count ("Kitchen 10/43"), then a grid of slots.
- **Catalogue numbers**: every output in the theme is numbered in age order, then recipe order (No. 001 is the first thing you could ever make). The number shows on every slot, found or not, so the gaps in the set are visible.
- Found slot: tier colour, pictogram, name, and the find date ("Oct 31"); finds from before dates were recorded read "early find". Tap to open its detail card on top of the book; closing it returns to the book.
- Unfound slot: a dashed outline, the pictogram as a grey silhouette, its number and "?". Not tappable.
- The detail card's catalogue line: "No. 004 · unearthed October 28, 2026", "unearthed before records began", or "not found yet".

## Sound

All sound is synthesised live with the Web Audio API: two generative music tracks and a set of effects in the same key, with no audio files.

**Settings** (speaker icon in the age row opens a menu)

- Music: **Calm piano**, **Handpan** or **No music**. Sound effects on/off. Volume slider (default 0.8).
- Off by default. A legacy single on/off (`madeof:sound` = 1) migrates to Handpan with effects on.
- Browsers block sound until a tap, so music starts on the first pointer-down in Combine. It stops on leaving Combine or when the page is hidden.

**Signal chain**

- Master gain 0.9 × volume, then a compressor (threshold −18 dB, ratio 3), then the speakers.
- Reverb: a convolver with a 3.4 s stereo impulse of noise decaying as (1 − t)³, at wet gain 0.5.
- Music bus gain 0.2 for piano, 0.16 for handpan, sent dry and to the reverb.
- Effects bus gain 0.11, then a low-pass at 1,800 Hz (Q 0.3), sent dry and to the reverb at ×1.4. Effects sit well under the music.
- Scheduler: a 120 ms interval scheduling notes 0.4–0.5 s ahead on the audio clock, with ±20 ms human timing jitter.

**Voices**

| Voice | Partials (frequency ×, gain, decay s) | Other |
| --- | --- | --- |
| Handpan strike | 1, 1, 2.6 · 2, 0.42, 1.3 · 3, 0.16, 0.55 · 1.0035, 0.22, 2.2 (sines) | 6 ms attack; low-pass at min(5200, 9f); a hand thump: a sine dropping from 0.5f to 0.35f over 80 ms, gain 0.18 |
| Felt piano key | 1 (triangle), 1, 4.2 · 2, 0.3, 2.4 · 3, 0.1, 1.3 · 4, 0.04, 0.8 · 1.0018, 0.35, 3.6 | 18 ms attack; low-pass sweeping from min(4200, 7f) down to max(300, 1.6f) over 1.8 s, so it darkens as it rings |

Decays are exponential to silence.

**Handpan music** (D Kurd: D3, A3, Bb3, C4, D4, E4, F4, G4, A4, C5)

- Half-beats of 0.39 s. The low D sounds every 16 half-beats; A3 at the half-way point 60% of the time.
- Phrases of 3–7 notes, then 2–5 half-beats of rest.
- A note plays with probability 0.5 + 0.04 × age index, scaled by 0.45 on off-beats. The melody random-walks: +1 or −1 step 35% each, +2 or −2 12% each, else stay. 12% of notes add the note two steps up.

**Calm piano music** (D major, about one beat a second)

- Beat 1.05 s, eight beats per chord. Chords (MIDI numbers): Dmaj7 \[38, 62, 66, 69, 73\], Bm7 \[35, 59, 62, 66, 69\], Gmaj7 \[31, 55, 59, 62, 66\], A \[33, 57, 61, 64, 71\]. The next chord is +1 (80%) or +2 (20%) around the loop.
- Beat 1 of a chord: the root an octave up, soft; half the time a second chord tone. 18% of bars go nearly silent.
- Other beats: a random chord tone, 42% on even beats and 16% on odd ones. On beat 5, 35% of the time a high melody note from \[74, 76, 78, 81, 83, 86\], sometimes answered half a beat later by a note 2–3 semitones lower.

**Effects** (scale = D major pentatonic \[50, 57, 59, 62, 64, 66, 69, 71, 74, 76\] with piano music, else D Kurd; voice = piano key with piano music, else handpan)

| Event | Sound |
| --- | --- |
| Place | One soft note from the top half of the scale |
| Combine | A rising run, 1 + chain notes (max 5), 90 ms apart |
| Discovery, close call | Four notes (degrees 3, 5, 7, 9), 120 ms apart |
| New age | Six notes (0, 4, 6, 7, 8, 9), 140 ms apart |
| Ship to shelf | The top note an octave up, quiet |
| No recipe | Two short muted notes, falling |
| Crumble | A band-passed noise whoosh, 900 to 250 Hz over 0.35 s |
| Game over | Five notes falling (9, 7, 5, 3, 0), 220 ms apart |

Phones also get short vibrations for place, combine, close call and new age.

## UI and layout

On a phone the whole game fits one screen with no scrolling. The board is always full width, and helpers and settings live behind single buttons.

**Screen, top to bottom**

1. Top row: score (with best under it), the theme button ("Everyday ▾", or "Daily"), and **Helpers** with its count badge (becomes **Cancel** during Move or Clear).
2. Tip line: one line on phones, cut with an ellipsis; hidden on screens 560 px tall or less.
3. Age row: "Age 2 Earth", progress bar, "3/8 → Craft", the book icon, the speaker icon.
4. Shelf strip: hidden while empty on screens 640 px tall or less.
5. Board, then the tray of three tiles.

**Fitting phones** (viewport width 600 px or less)

- Compact site header in Combine: brand at 19 px, the tabs in one horizontally scrolling row, scrolled so the Combine tab is visible. The page's "Combine" heading and the legend are hidden.
- Board width = the available height (visual viewport height − the board's top − everything else in the game − 10 px), clamped between 200 px and full width. Recomputed on resize and when the browser toolbars show or hide.
- Tray tiles = the same available height ÷ 6, between 50 and 84 px.
- Checked from 470 to 700 px tall: everything visible.

**Tiles**

- Square cells in a grid of equal `minmax(0, 1fr)` columns (plain `1fr` let one cell blow up during an animation).
- Tier fill, ink outline, a small offset shadow. Pictogram at 52% of the cell.
- Names scale with the cell using a container query: clamp(9 px, 15.5cqw, 12 px), up to two lines, words never split. Smaller when the longest word has 7–9 letters (12.5cqw) or 10+ (10.5cqw).
- Elements show their symbol (Fe, Na) in place of a pictogram.
- Every item has a pictogram; new items fall back to a pictogram for their kind.

**Interactions**

- Drag from the tray: a 64 px ghost tile follows, tilted 5° and held above the finger. The target square is read under the finger 0.4 of a tile above it. A target gets a solid outline if the drop works, a red dashed one if not.
- Tap a tray tile to select it, then tap a square or tile. Tap it again to deselect.
- Press and hold a tray tile for 450 ms: its detail card (no select, the phone's long-press menu is suppressed).
- Tap a board tile with nothing selected: its detail card.
- Escape closes the top overlay, then cancels any mode or selection.

**Overlays**

Discovery card, new-age card and hint card (tap to close, timed); the choice picker (must pick); theme menu, Helpers menu, sound menu, collection book, detail card and game-over summary. Centred dialogs sit over a dim scrim; their entrance animation keeps the centring transform, so they don't jump. Long dialogs scroll with their buttons pinned at the bottom.

**Accessibility**

- Every square is a button with a label saying what is on it or what placing there would make ("Empty. Placing here makes glue", "crumbling… gone in 2 turns").
- The tip line is a live region. Dialogs use `role=dialog`. Helpers have labels with their counts.
- Reduced motion: animation waits drop to 0.
- Colours come from theme tokens, so light and dark both work.

## Next.js implementation notes

Build the game as a pure, deterministic engine with the UI, sound and storage around it. The prototype mixes these in one file; separating them is what makes the rules testable and the daily fair.

**Suggested modules**

| Module | Responsibility |
| --- | --- |
| `combine/data` | Build each theme's recipe set from the knowledge base: physical-things filter, fab exclusions, theme rules, same-ingredient groups, derived sets. Run at build time and ship as static JSON per theme, since the knowledge base will grow. |
| `combine/levels` | `refine()`, recipe levels, age cuts and the later-age fix-up. Also build time. |
| `combine/rng` | mulberry32 over a state int kept in game state; FNV-1a for the daily seed. |
| `combine/match` | Group growing from a square; drop-on-top matching; alternatives. |
| `combine/deal` | Tile picking and the one-or-two-play guarantee. |
| `combine/engine` | `reduce(state, action) → {state, events}` for place, drop-on-top, choose, move, swap, clear, hint, new game. Scoring, ages, crumbling, chains and game over live here. |
| `components/combine` | Board, Tile, Tray, TopBar, AgeBar, Shelf, the overlays. Animate from the engine's events, not from state diffs. |
| `lib/audio` | One AudioContext singleton: tracks, effects, settings. Triggered by engine events. |
| `combine/storage` | Local saves now, account sync later. Same fields as the prototype. |

**Rules to keep when porting**

- No game randomness outside the engine's RNG, or saves and the daily stop matching.
- "Choose what to make" is a state, not a promise: the engine stops in `choosing {options, cells}` and resumes on a `choose(k)` action. Chain steps never choose.
- Helpers' Move, Swap and Clear never run the after-turn step (no crumbling, no deal).
- Treat the prototype's resting/regrowing sources (`CB_KEEP`) and blueprints as dead code; both were tried and removed.

**Server pieces** (once accounts exist)

- Daily: decide whether the date is the player's local date (the prototype) or a fixed UTC day; store one result per player per day; a leaderboard of friends or groups. The play-test showed people already compete on it.
- Progress sync: found items, how they were made, find dates, best scores, saves.
- A link-only head-to-head is possible before that: the share URL carries a score, and the receiving game shows "Beat 12,840".

**Test plan**

- Unit: matching in every shape (line, L, 3×3, one tile out of contact fails); drop-on-top; alternatives; scoring examples; age ordering (no recipe needs a later-age part); save/restore round trip; the same daily seed gives the same first board and tray.
- Bot simulation: an all-knowing bot playing many games per theme and board size. Track the share of trays with a move within two plays (target 98% or more), moves per game, things made and ages reached. Prototype figures: about 65–250 placements per game depending on theme and board size, with the final age usually reached.
- End to end: drag, tap, long-press, the picker, each helper, the book and detail cards, the sound menu, and a 360×640 phone fit with no sideways scroll.

**Parked ideas**

- Small requests: one optional goal at a time that rewards a helper.
- Endless milestones on the game-over card ("First boat", "3 close calls, a record").
- Bigger moments for close calls and large groups (burst, shake).
- More themes from the same data: Kitchen, Wardrobe, Toy box.
- A fact per recipe, so the discovery card matches the exact combo.
- Open questions: keep places as items? Keep the big bang as the one non-physical exception?
