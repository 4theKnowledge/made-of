import type { GameState } from "@/combine/engine";
import { matchAt, matchOn } from "@/combine/match";
import type { CombineRecipe, ThemeBundle, ThemeKey } from "@/combine/types";

/** Hand-picked example chains shown in the Ages dialog, keyed by theme and
 *  then by 0-based age index. One canonical chain per age so the dialog is
 *  deterministic — rotating examples made players think the rules were
 *  changing. The last node is an item that lives in that band in the current
 *  KB; if the KB changes an id, the row is dropped and we re-pick here. */
export const AGE_CHAINS: Partial<Record<ThemeKey, string[][]>> = {
  everything: [
    ["hydrogen", "star"],
    ["clay", "brick"],
    ["wheat", "flour", "bread"],
    ["crude oil", "plastic", "tyre"],
    ["copper", "copper wire", "light bulb"],
    ["cotton", "thread", "fabric", "shirt"],
  ],
};

/** Per-cell preview when a tray tile is selected. Mirrors cbPreview from
 *  the prototype. Each entry is either a found output to render as a ghost
 *  on an empty cell, or an "on" marker for a valid drop-on-top target. */
export interface Preview {
  /** Output id if we have one to show (found alternatives only). */
  out?: string;
  /** True for drop-on-top targets. */
  on?: boolean;
  /** How many *known* alternatives exist for this recipe signature (for the
   *  +N badge). Counts only outputs the player has already unlocked — so the
   *  badge never leaks "there are 3 possibilities here" when the player can
   *  only see 1 of them. */
  n?: number;
}

export function computePreview(
  bundle: ThemeBundle,
  state: GameState,
  selected:
    | { source: "tray" | "hold"; slot: number }
    | { source: "board"; cell: number }
    | null,
  extraKnown: Iterable<string>,
): Map<number, Preview> {
  const out = new Map<number, Preview>();
  if (selected == null) return out;
  let x: string | null = null;
  // When the selected tile sits on the board (move helper tap-select), we
  // need to look at matches as if the source cell were already empty — the
  // engine vacates it before testing combines. Otherwise adjacency through
  // the source cell is both missed (the vacated-neighbour case) and the
  // source cell itself would spuriously appear as a destination.
  let board = state.board;
  let skipCell: number | null = null;
  if (selected.source === "board") {
    const tile = state.board[selected.cell];
    if (tile == null) return out;
    x = tile;
    board = state.board.slice();
    board[selected.cell] = null;
    skipCell = selected.cell;
  } else {
    const src = selected.source === "hold" ? state.hold : state.tray;
    x = src[selected.slot];
  }
  if (x == null) return out;
  // "Known" = anything found this game or anywhere in the player's lifetime
  // collection. Signed-out players will see the latter as empty.
  const found = new Set(state.found);
  for (const id of extraKnown) found.add(id);
  const altsOf = (r: CombineRecipe): CombineRecipe[] => {
    const key = [...r.all].sort().join("+");
    return bundle.sameIngredients.get(key) ?? [r];
  };
  const knownAlt = (r: CombineRecipe): CombineRecipe | null => {
    const alts = altsOf(r);
    return alts.find((q) => found.has(q.out)) ?? null;
  };
  const knownAltsCount = (r: CombineRecipe): number => {
    let n = 0;
    for (const q of altsOf(r)) if (found.has(q.out)) n++;
    return n;
  };
  for (let i = 0; i < board.length; i++) {
    if (i === skipCell) continue;
    const v = board[i];
    if (v) {
      const m = matchOn(bundle, board, i, x, state.n);
      if (!m) continue;
      const k = knownAlt(m.recipe);
      if (k) out.set(i, { out: k.out, on: true, n: knownAltsCount(m.recipe) });
      // Recipe matches but no alternative output is known — leave the cell
      // silent. Signalling "something happens here" would trivialise the
      // hunt for unknown terminals; a follow-up task may expose this as an
      // opt-in (default off).
    }
  }
  for (let i = 0; i < board.length; i++) {
    if (i === skipCell) continue;
    if (board[i]) continue;
    const m = matchAt(bundle, board, i, x, state.n);
    if (!m) continue;
    const k = knownAlt(m.recipe);
    if (k) out.set(i, { out: k.out, n: knownAltsCount(m.recipe) });
  }
  return out;
}

/** Mastery accounting for a single item. `made` is the sig count the player
 *  has actually produced; `available` is the count of recipe variants whose
 *  ingredients are all known to the player (so admins adding an upstream
 *  variant can't retroactively drop mastery, and we never surface a count
 *  that references ingredients the player hasn't seen). `mastered` means
 *  there is at least one path and the player has made all visible ones. */
export interface MasteryInfo {
  made: number;
  available: number;
  mastered: boolean;
}

/** Compute mastery for `itemId` given the player's known ingredient set and
 *  the recipe signatures they've produced. See `MasteryInfo` for shape. */
export function computeMastery(
  bundle: ThemeBundle,
  itemId: string,
  known: ReadonlySet<string>,
  madeSignatures: ReadonlySet<string>,
): MasteryInfo {
  // Collect every variant whose ingredients are all known or base. Dedupe by
  // sorted-ingredient signature — alt-output variants share the same sig
  // (and would otherwise be double-counted here).
  const availableSigs = new Set<string>();
  for (const r of bundle.recipes) {
    if (r.out !== itemId) continue;
    if (!r.all.every((pid) => known.has(pid) || bundle.base.includes(pid))) {
      continue;
    }
    availableSigs.add([...r.all].sort().join("+"));
  }
  let made = 0;
  for (const sig of availableSigs) if (madeSignatures.has(sig)) made++;
  const available = availableSigs.size;
  return { made, available, mastered: available > 0 && made === available };
}

/**
 * Transient per-move visual state. Keys match the prototype's `renderCB(fx)`
 * contract. Each entry is set from an engine event, applied as a CSS class
 * or badge on the matching cell, and cleared after its animation duration.
 */
export interface Fx {
  placed?: number;
  nope?: number;
  fuse?: Set<number>;
  /** Pre-consume tile ids keyed by cell, rendered as overlays during the
   *  fuse pulse so the player sees the ingredients glow and shrink into
   *  the result. The engine has already nulled these cells in state. */
  fuseGhosts?: Map<number, string>;
  pop?: number;
  burst?: { at: number; pts: number; mult: number };
  /** Ghost output tile shown at `pop` while the result pops into place —
   *  only needed when the engine has already cleared the cell (e.g. a
   *  terminal result that shipped straight off the board). */
  popGhost?: string;
  shipped?: { at: number; bonus: number; out: string };
  crumble?: Set<number>;
  /** Chain multiplier for the top-row ×N badge. */
  chain?: number;
  /** Close-call bonus for the "Close call!" badge. */
  close?: number;
  /** Cell where a new discovery just formed — triggers a tier-colored
   *  sparkle pulse after the pop phase. */
  discover?: number;
  /** Chain visualisation. One trace per in-flight chain. The overlay
   *  reads this to draw arcs between each step's ingredients and output,
   *  and cells listed in `members` get a persistent tint for the chain's
   *  lifetime. `tier` keys the accent colour of the final output.
   *  Cleared ~900ms after the chain's last pop. */
  trace?: ChainTrace;
}

export interface ChainStep {
  /** Ingredient cells for this step. */
  from: number[];
  /** Output cell. */
  to: number;
  /** Tier of the output tile — drives arc colour via --f<tier>. */
  tier: string;
  /** When (in trace-local ms) the arc should start drawing. */
  drawAt: number;
}

export interface ChainTrace {
  steps: ChainStep[];
  /** All cells touched by the chain (ingredients + outputs). */
  members: Set<number>;
  /** Tier of the final output — used as the chain's dominant accent. */
  tier: string;
  /** Local time (ms) when the trace first mounts; the overlay uses
   *  `performance.now() - startedAt` to pick which steps have "drawn". */
  startedAt: number;
  /** True when the trace represents a single, non-chained combine.
   *  Overlay renders a lighter variant and skips the member-cell aura. */
  solo: boolean;
}
