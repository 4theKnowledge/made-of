/**
 * Mechanical content-shape guardrails.
 *
 * Two invariants:
 *
 * 1. **Every item reaches big bang.** `big bang` is the only acceptable
 *    graph-level dead-end — everything else must have at least one chain
 *    of `recipes.*.{f,w,n,e}` edges leading upstream to it. When an item
 *    is authored without origins (e.g. `apple tree` with no recipes), it
 *    becomes an island and breaks the thematic premise of Made Of.
 *
 * 2. **No dead-end raws in a Combine theme.** A theme item that has no
 *    incoming recipes AND is only used as input to 1-input (promote)
 *    recipes can never participate in a combine — it clutters the board.
 *    This is a subset of #1 for items in a Combine theme.
 *
 * Both tests name offenders so the author can grep straight to the fix.
 */

import { describe, it, expect } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import type { ThemeKey } from "../types";

describe("combine content shape", () => {
  it("every item reaches big bang via upstream edges", () => {
    const kb = loadKnowledgeBase();
    const snap = buildSnapshot(toRows(kb));
    const bigBang = [...snap.nodes.values()].find((n) => n.name === "big bang");
    expect(bigBang, "`big bang` item not found in KB").toBeDefined();

    const reach = new Set<string>([bigBang!.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of snap.nodes.values()) {
        if (reach.has(n.id)) continue;
        for (const edge of n.up) {
          if (reach.has(edge.id)) {
            reach.add(n.id);
            changed = true;
            break;
          }
        }
      }
    }

    const orphans: string[] = [];
    for (const n of snap.nodes.values()) {
      if (!reach.has(n.id)) orphans.push(`${n.name} (${n.tier}/${n.kind})`);
    }

    if (orphans.length > 0) {
      orphans.sort();
      throw new Error(
        [
          `${orphans.length} item(s) have no upstream path to "big bang":`,
          ...orphans.map((o) => `  ${o}`),
          "",
          "Author at least one upstream recipe edge on each (e.g. `recipes: [{ e: [\"mammals\"] }]`)",
          "so the item chains back to the big bang.",
        ].join("\n"),
      );
    }
    expect(orphans).toEqual([]);
  });

  it("no dead-end raws in any Combine theme", () => {
    const kb = loadKnowledgeBase();
    const snap = buildSnapshot(toRows(kb));
    const themes: ThemeKey[] = ["everything"];
    const offenders: { theme: string; name: string; outputs: string[] }[] = [];

    for (const theme of themes) {
      const bundle = buildThemeBundle(snap, theme);
      const inPool = new Set<string>();
      for (const r of bundle.recipes) {
        for (const id of r.all) inPool.add(id);
        inPool.add(r.out);
      }
      for (const id of inPool) {
        if (bundle.outputs.has(id)) continue; // has incoming — not raw
        const usedIn = bundle.recipes.filter((r) => r.all.includes(id));
        if (usedIn.length === 0) continue;
        const maxSize = Math.max(...usedIn.map((r) => r.all.length));
        if (maxSize === 1) {
          const name = bundle.items.get(id)?.name ?? id;
          const outputs = usedIn
            .map((r) => bundle.items.get(r.out)?.name ?? r.out)
            .sort();
          offenders.push({ theme, name, outputs });
        }
      }
    }

    if (offenders.length > 0) {
      const lines = offenders.map(
        (o) =>
          `  [${o.theme}] "${o.name}" is only used in 1-input promotes to: ${o.outputs.join(", ")}`,
      );
      throw new Error(
        [
          `Found ${offenders.length} dead-end raw item(s) in Combine themes:`,
          ...lines,
          "",
          "Author at least one ingredient recipe (e.g. `recipes: [{ e: [\"land plants\"] }]`)",
          "on each offender so Combine can place it in a sensible band.",
        ].join("\n"),
      );
    }
    expect(offenders).toEqual([]);
  });
});
