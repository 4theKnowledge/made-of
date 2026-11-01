/**
 * Dump all outputs per band for both themes. Helps decide how many ages to
 * carve and what to name them. Run with:
 *   npx tsx src/combine/__tests__/inspect-bands.ts [theme] [numAges]
 */
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import type { ThemeKey } from "../types";

function dump(theme: ThemeKey, numAgesOverride?: number) {
  const kb = loadKnowledgeBase();
  const snap = buildSnapshot(toRows(kb));
  const bundle = buildThemeBundle(snap, theme);

  // If an override numAges was passed, re-run assignAges with that cardinality.
  // We can't do that without a theme change; instead, print recipes with
  // their raw levels so we can see what split would make sense.

  // Group outputs by band.
  const byBand = new Map<number, string[]>();
  for (const r of bundle.recipes) {
    const list = byBand.get(r.band) ?? [];
    list.push(r.out);
    byBand.set(r.band, list);
  }
  console.log(`\n== ${theme} (${bundle.theme.ages.length} ages) ==`);
  for (let b = 1; b <= bundle.theme.ages.length; b++) {
    const outs = [...new Set(byBand.get(b) ?? [])].map((id) => bundle.items.get(id)?.name ?? id);
    console.log(`\nBand ${b} ${bundle.theme.ages[b - 1]} (${outs.length} outputs):`);
    console.log("  " + outs.sort().join(", "));
  }

  // Also print the raw sorted levels, so we can see natural clusters.
  const lvls = [...new Set(bundle.recipes.map((r) => r.lvl))].sort((a, b) => a - b);
  console.log("\nDistinct refine levels:", lvls);
  const histogram = new Map<number, number>();
  for (const r of bundle.recipes) histogram.set(r.lvl, (histogram.get(r.lvl) ?? 0) + 1);
  for (const l of lvls) console.log(`  lvl ${l}: ${histogram.get(l)} recipes`);
  void numAgesOverride;
}

const theme = (process.argv[2] as ThemeKey) || "everything";
dump(theme);
