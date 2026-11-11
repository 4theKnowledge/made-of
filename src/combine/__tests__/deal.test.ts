import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import { dealTray, pickOne, type DealerView } from "../deal";
import { playsInOne, playsInTwo, type Board } from "../match";
import { makeRng } from "../rng";

const snap = buildSnapshot(toRows(loadKnowledgeBase()));
const everything = buildThemeBundle(snap, "everything");

function emptyBoard(size: number): Board {
  return Array(size * size).fill(null);
}

function freshView(size: number, seed: number): DealerView {
  return {
    bundle: everything,
    board: emptyBoard(size),
    tray: [null, null, null],
    size,
    rng: makeRng(seed),
    found: [],
  };
}

describe("pickOne", () => {
  it("returns an item id from the bundle", () => {
    const v = freshView(5, 1);
    const x = pickOne(v);
    expect(x).not.toBeNull();
    expect(everything.ingredients.has(x!) || everything.outputs.has(x!)).toBe(
      true,
    );
  });

  it("is deterministic for a given seed", () => {
    const a = pickOne(freshView(5, 42));
    const b = pickOne(freshView(5, 42));
    expect(a).toBe(b);
  });
});

describe("dealTray", () => {
  it("fills three slots with non-null values on an empty board", () => {
    const v = freshView(5, 100);
    const tray = dealTray(v);
    expect(tray).toHaveLength(3);
    for (const t of tray) expect(t).not.toBeNull();
  });

  it("is deterministic for a given seed", () => {
    const a = dealTray(freshView(5, 7));
    const b = dealTray(freshView(5, 7));
    expect(a).toEqual(b);
  });

  it("guarantees a play within two placements (single tray, empty board)", () => {
    const v = freshView(5, 777);
    const tray = dealTray(v);
    const one = playsInOne(everything, v.board, tray, 5);
    const two = playsInTwo(everything, v.board, tray, 5);
    expect(one || two).toBe(true);
  });
});

describe("1-input recipes don't poison dealer partner selection", () => {
  // The dealer walks `r.all` to find partners for a piled tile; for
  // 1-input recipes that loop yields zero entries, so these recipes
  // naturally contribute nothing. Regression guard: with a board piling
  // a known 1-input ingredient (water), the tray must not end up with
  // nothing-to-do just because 1-input recipes exist in the bundle.
  it("Everything deals a playable tray with water piled on the board", () => {
    const water = snap.bySlug.get("water")?.id;
    expect(water).toBeDefined();
    let successes = 0;
    const trials = 50;
    for (let i = 0; i < trials; i++) {
      const size = 5;
      const board = emptyBoard(size);
      // Pile 3 waters so `heaviestPile` fires and the partner-pool
      // logic is exercised.
      board[0] = water!;
      board[1] = water!;
      board[2] = water!;
      const v: DealerView = {
        bundle: everything,
        found: [],
        board,
        tray: [null, null, null],
        size,
        rng: makeRng(9000 + i),
      };
      const tray = dealTray(v);
      // Every slot filled.
      expect(tray.every((t) => t != null)).toBe(true);
      // None of the slots should be water itself only via a 1-input
      // "recipe" — the partner loop filters those out naturally. Count
      // runs that produce a legal play.
      if (
        playsInOne(everything, v.board, tray, size) ||
        playsInTwo(everything, v.board, tray, size)
      ) {
        successes++;
      }
    }
    // Same bar as the generic bot-sim: at least 98% of trays are
    // playable. If the 1-input filter leaked into partner pools, this
    // would collapse because the dealer would "see" fake partners.
    expect(successes / trials).toBeGreaterThanOrEqual(0.98);
  });
});

describe("dealing guarantee (bot simulation, Everything 6×6)", () => {
  it("≥98% of trays on empty boards have a play within two placements", () => {
    let total = 0;
    let solvable = 0;
    const size = 6;
    for (let i = 0; i < 100; i++) {
      const v: DealerView = {
        bundle: everything,
        found: [],
        board: emptyBoard(size),
        tray: [null, null, null],
        size,
        rng: makeRng(5000 + i),
      };
      const tray = dealTray(v);
      const ok =
        playsInOne(everything, v.board, tray, size) ||
        playsInTwo(everything, v.board, tray, size);
      total++;
      if (ok) solvable++;
    }
    const pct = solvable / total;
    expect(pct).toBeGreaterThanOrEqual(0.98);
  });
});

describe("manifest partner-bias (T-0245)", () => {
  // Pick a simple sub-graph from the Everything bundle: find a 2-input
  // recipe whose output exists in the outputs set so we can declare it
  // the manifest and check the partners surface more often.
  const twoInputRecipe = everything.recipes.find(
    (r) => r.all.length === 2 && r.all.every((x) => everything.base.includes(x)),
  );
  if (!twoInputRecipe) throw new Error("no 2-input base-only recipe found for test");
  const manifestItem = twoInputRecipe.out;
  const partners = twoInputRecipe.all;

  function viewWith(bias: number, seed: number): DealerView {
    return {
      bundle: everything,
      board: emptyBoard(5),
      tray: [null, null, null],
      size: 5,
      rng: makeRng(seed),
      found: [],
      manifest: [manifestItem],
      manifestFound: [],
      manifestPartnerBias: bias,
    };
  }

  it("partnerBias=0 behaves identically to a non-manifest dealer", () => {
    // Deal many trays with bias=0 and bias=null — the two should agree.
    const sampleSize = 100;
    for (let i = 0; i < sampleSize; i++) {
      const biasZero = dealTray(viewWith(0, 1000 + i));
      const noManifest = dealTray({
        bundle: everything,
        board: emptyBoard(5),
        tray: [null, null, null],
        size: 5,
        rng: makeRng(1000 + i),
        found: [],
      });
      expect(biasZero).toEqual(noManifest);
    }
  });

  it("partnerBias>0 surfaces unfound-manifest partners more often than bias=0", () => {
    // Count how often any manifest partner shows up in the tray with
    // bias=0 vs. bias=1 (very strong). Expect the biased sample to be
    // strictly higher — a 2× multiplier should materially shift the
    // distribution even against a dealer that's already reachability-
    // aware. 80 samples is plenty of statistical power with bias=1 while
    // keeping the test under ~15s.
    const sampleSize = 80;
    const partnerSet = new Set(partners);
    let baseHits = 0;
    let biasedHits = 0;
    for (let i = 0; i < sampleSize; i++) {
      const base = dealTray(viewWith(0, 20000 + i));
      const biased = dealTray(viewWith(1, 20000 + i));
      for (const t of base) if (t && partnerSet.has(t)) baseHits++;
      for (const t of biased) if (t && partnerSet.has(t)) biasedHits++;
    }
    expect(biasedHits).toBeGreaterThan(baseHits);
  });

  it("items on the manifest that are already found drop out of the bias set", () => {
    // With both partners "already found" via manifestFound (treated as
    // the win having happened), the bias set is empty and the dealer
    // falls back to the base distribution. Compare against bias=0.
    const sampleSize = 50;
    for (let i = 0; i < sampleSize; i++) {
      const biased: DealerView = {
        bundle: everything,
        board: emptyBoard(5),
        tray: [null, null, null],
        size: 5,
        rng: makeRng(30000 + i),
        found: [],
        manifest: [manifestItem],
        manifestFound: [manifestItem],
        manifestPartnerBias: 1,
      };
      const unbiased = viewWith(0, 30000 + i);
      expect(dealTray(biased)).toEqual(dealTray(unbiased));
    }
  });
});

/** Build a mid-game "found" set: expand through recipes BFS-style until
 *  we have >=N discoveries. Keeps the softPool reachability wide so the
 *  dealer has a diverse candidate set — closer to a real player's mid-game
 *  state than a fresh run. */
function midGameFound(target: number): string[] {
  const found = new Set<string>(everything.base);
  let changed = true;
  while (changed && found.size < target) {
    changed = false;
    for (const r of everything.recipes) {
      if (found.has(r.out)) continue;
      if (r.all.every((x) => found.has(x))) {
        found.add(r.out);
        changed = true;
        if (found.size >= target) break;
      }
    }
  }
  return [...found];
}

describe("kind-diversity cap (T-0317)", () => {
  // Mid-game: two same-kind tiles pre-placed on the board. The dealer
  // should bias toward other kinds. Low-but-nonzero expected because the
  // fallback kicks in when a layer's candidate set is all one kind.
  it("reduces the rate of same-kind thirds when two of a kind are on board", () => {
    const found = midGameFound(60);
    // Count reachable items per kind in this found-state so we can
    // pick a kind that has plenty of same-kind siblings AND competing
    // kinds — otherwise the fallback dominates and nothing is testable.
    const byKind = new Map<string, string[]>();
    for (const id of found) {
      const it = everything.items.get(id);
      if (!it) continue;
      const arr = byKind.get(it.kind) ?? [];
      arr.push(id);
      byKind.set(it.kind, arr);
    }
    const kindsWithMany = [...byKind.entries()]
      .filter(([, ids]) => ids.length >= 3)
      .sort((a, b) => b[1].length - a[1].length);
    if (kindsWithMany.length < 2) {
      throw new Error("mid-game found set doesn't have enough kind diversity");
    }
    const [targetKind, targetIds] = kindsWithMany[0];

    const size = 5;
    const trials = 40;
    let capHits = 0;
    let noCapHits = 0;
    for (let i = 0; i < trials; i++) {
      // With two same-kind tiles on board → cap should fire.
      const boardCap = emptyBoard(size);
      boardCap[0] = targetIds[0];
      boardCap[1] = targetIds[1];
      const vCap: DealerView = {
        bundle: everything,
        board: boardCap,
        tray: [null, null, null],
        size,
        rng: makeRng(40000 + i),
        found,
      };
      const trayCap = dealTray(vCap);
      for (const t of trayCap) {
        if (!t) continue;
        if (everything.items.get(t)?.kind === targetKind) capHits++;
      }
      // Baseline: only one of that kind on board → cap doesn't fire.
      const boardNoCap = emptyBoard(size);
      boardNoCap[0] = targetIds[0];
      const vNoCap: DealerView = {
        bundle: everything,
        board: boardNoCap,
        tray: [null, null, null],
        size,
        rng: makeRng(40000 + i),
        found,
      };
      const trayNoCap = dealTray(vNoCap);
      for (const t of trayNoCap) {
        if (!t) continue;
        if (everything.items.get(t)?.kind === targetKind) noCapHits++;
      }
    }
    // Cap should materially reduce same-kind draws.
    expect(capHits).toBeLessThan(noCapHits);
  });
});

describe("recency penalty (T-0317)", () => {
  // With a recent tray stocked with one kind, the next deal should favour
  // other kinds. We compare "recent tray says kind X" vs "recent tray says
  // kind Y" and check that X shows up in the next tray *less* in the
  // first case than the second.
  it("down-weights kinds seen in recent trays", () => {
    const size = 5;
    const trials = 50;
    const found = midGameFound(60);

    const byKind = new Map<string, string[]>();
    for (const id of found) {
      const it = everything.items.get(id);
      if (!it) continue;
      const arr = byKind.get(it.kind) ?? [];
      arr.push(id);
      byKind.set(it.kind, arr);
    }
    const kinds = [...byKind.entries()]
      .filter(([, ids]) => ids.length >= 3)
      .map(([k]) => k);
    if (kinds.length < 2) throw new Error("need at least 2 kinds for test");
    const kindA = kinds[0];
    const kindB = kinds[1];
    const sampleA = byKind.get(kindA)![0];

    let hitsWhenAIsRecent = 0;
    let hitsWhenBIsRecent = 0;
    for (let i = 0; i < trials; i++) {
      // Case 1: recent tray contains a kindA tile → kindA should drop.
      const vA: DealerView = {
        bundle: everything,
        board: emptyBoard(size),
        tray: [null, null, null],
        size,
        rng: makeRng(50000 + i),
        found,
        recentTrays: [[sampleA]],
      };
      const trayA = dealTray(vA);
      for (const t of trayA) {
        if (!t) continue;
        if (everything.items.get(t)?.kind === kindA) hitsWhenAIsRecent++;
      }
      // Case 2: recent tray contains kindB tile → kindA free to appear.
      const vB: DealerView = {
        bundle: everything,
        board: emptyBoard(size),
        tray: [null, null, null],
        size,
        rng: makeRng(50000 + i),
        found,
        recentTrays: [[byKind.get(kindB)![0]]],
      };
      const trayB = dealTray(vB);
      for (const t of trayB) {
        if (!t) continue;
        if (everything.items.get(t)?.kind === kindA) hitsWhenBIsRecent++;
      }
    }
    expect(hitsWhenAIsRecent).toBeLessThan(hitsWhenBIsRecent);
  });

  it("stays deterministic for a given seed + recentTrays", () => {
    const v1: DealerView = {
      bundle: everything,
      board: emptyBoard(5),
      tray: [null, null, null],
      size: 5,
      rng: makeRng(12345),
      found: [],
      recentTrays: [["hydrogen"]],
    };
    const v2: DealerView = {
      bundle: everything,
      board: emptyBoard(5),
      tray: [null, null, null],
      size: 5,
      rng: makeRng(12345),
      found: [],
      recentTrays: [["hydrogen"]],
    };
    expect(dealTray(v1)).toEqual(dealTray(v2));
  });
});

describe("terminal tiles are never dealt", () => {
  // Sun has recipe hydrogen+helium→sun but is consumed by nothing, so it
  // sits dead on the board/tray until crumble. Terminals must be
  // craftable but never dealt raw. Sweep a large seed range on empty +
  // partially-populated boards and confirm no terminal ever appears.
  it("neither pickOne nor dealTray ever surfaces a terminal", () => {
    expect(everything.terminal.size).toBeGreaterThan(0);
    const probes = 400;
    for (let seed = 1; seed <= probes; seed++) {
      // Fresh run, no discoveries.
      const tray = dealTray({
        bundle: everything,
        board: emptyBoard(5),
        tray: [null, null, null],
        size: 5,
        rng: makeRng(seed),
        found: [],
      });
      for (const t of tray) {
        expect(t == null || !everything.terminal.has(t)).toBe(true);
      }
      // After the player has "discovered" every terminal — they still
      // must not be dealt (prior behaviour leaked them in via `known`).
      const tray2 = dealTray({
        bundle: everything,
        board: emptyBoard(5),
        tray: [null, null, null],
        size: 5,
        rng: makeRng(1_000_000 + seed),
        found: [...everything.terminal],
      });
      for (const t of tray2) {
        expect(t == null || !everything.terminal.has(t)).toBe(true);
      }
    }
  });
});
