/**
 * One-off diagnostic. Dumps the shape of the Combine bundle for the given
 * theme against the live DB. Used to verify the impact of expanding
 * recipe ingredients to include n and e links.
 *
 * Run: `source .env && DATABASE_URL="$DATABASE_URL" npx tsx scripts/inspect-recipes.ts`
 */
import { loadRowsFromDb } from "../src/graph/load";
import { buildSnapshot } from "../src/graph/snapshot";
import { buildThemeBundle } from "../src/combine/data";

async function main() {
  const rows = await loadRowsFromDb({ liveOnly: true });
  const snap = buildSnapshot(rows);
  const bundle = buildThemeBundle(snap, "everything");

  console.log("Recipes:", bundle.recipes.length);
  console.log("Outputs:", bundle.outputs.size);
  console.log("Base ingredients:", bundle.base.length);
  console.log("Ages:", bundle.theme.ages.length);

  const sizes = new Map<number, number>();
  for (const r of bundle.recipes) {
    sizes.set(r.all.length, (sizes.get(r.all.length) ?? 0) + 1);
  }
  console.log("\nIngredient-count histogram:");
  for (const k of [...sizes.keys()].sort((a, b) => a - b)) {
    console.log(`  ${k} ingredients: ${sizes.get(k)} recipes`);
  }

  const sorted = [...bundle.recipes]
    .sort((a, b) => b.all.length - a.all.length)
    .slice(0, 10);
  console.log("\nBiggest recipes (top 10):");
  for (const r of sorted) {
    const name = bundle.items.get(r.out)?.name ?? r.out;
    console.log(
      `  ${name} (${r.all.length}): ${r.all
        .map((id) => bundle.items.get(id)?.name ?? id)
        .join(" + ")}`,
    );
  }

  const amph = bundle.recipes.filter(
    (r) => bundle.items.get(r.out)?.name === "amphibians",
  );
  console.log("\nAmphibians recipes:", amph.length);
  for (const r of amph) {
    console.log(
      `  all: ${r.all
        .map((id) => bundle.items.get(id)?.name ?? id)
        .join(" + ")}`,
    );
  }
}

main().then(() => process.exit(0));
