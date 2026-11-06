/**
 * One-shot migration: author upstream `evolved from` recipes for the
 * items that previously had no origin. See T-0153.
 *
 * Why: these items were authored with no `recipes`, so computeRefine
 * classified them as level-0 raw and assignAges parked them in band 1 of
 * Combine's Everything theme. Also, they broke the "every item chains
 * back to big bang" invariant.
 *
 * Safe to run against any live DB — looks up items by name (not id), so
 * dev/prod id drift is handled. Idempotent: skips items that already have
 * at least one recipe.
 *
 * Run with:
 *   DATABASE_URL=... npx tsx scripts/migrate-plant-origins.ts
 *   # Add --dry-run to print planned changes without writing.
 */

import { inArray } from "drizzle-orm";
import { closeDb, getDb, schema } from "../src/db/client";

// item name → origin name (its `evolved from` target).
const ORIGINS: Record<string, string> = {
  "apple tree": "land plants",
  "olive tree": "land plants",
  "grape vine": "land plants",
  "rice plant": "land plants",
  "potato plant": "land plants",
  "soybean plant": "land plants",
  "tea plant": "land plants",
  "maize plant": "land plants",
  "barley": "land plants",
  "lemon tree": "land plants",
  "pepper plant": "land plants",
  "flax plant": "land plants",
  "bamboo": "land plants",
  "pig": "mammals",
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = getDb();

  const allNames = [
    ...new Set([...Object.keys(ORIGINS), ...Object.values(ORIGINS)]),
  ];

  const items = await db
    .select({ id: schema.items.id, name: schema.items.name })
    .from(schema.items)
    .where(inArray(schema.items.name, allNames));

  const idByName = new Map(items.map((i) => [i.name, i.id] as const));

  const missing = allNames.filter((n) => !idByName.has(n));
  if (missing.length > 0) {
    throw new Error(`Missing items in DB: ${missing.join(", ")}`);
  }

  const childNames = Object.keys(ORIGINS);
  const existingRecipes = await db
    .select({ itemId: schema.recipes.itemId })
    .from(schema.recipes)
    .where(
      inArray(
        schema.recipes.itemId,
        childNames.map((n) => idByName.get(n)!),
      ),
    );
  const hasRecipe = new Set(existingRecipes.map((r) => r.itemId));

  const toInsert = childNames.filter((n) => !hasRecipe.has(idByName.get(n)!));
  const toSkip = childNames.filter((n) => hasRecipe.has(idByName.get(n)!));

  console.log(`Items resolved: ${childNames.length}`);
  console.log(`Already have recipes (skip): ${toSkip.length} — ${toSkip.join(", ") || "(none)"}`);
  console.log(`Will author origin for: ${toInsert.length}`);
  for (const name of toInsert) {
    console.log(`  ${name} <-e- ${ORIGINS[name]}`);
  }

  if (toInsert.length === 0) {
    console.log("Nothing to do.");
    await closeDb();
    return;
  }

  if (dryRun) {
    console.log("\n[dry-run] no changes written.");
    await closeDb();
    return;
  }

  await db.transaction(async (tx) => {
    for (const name of toInsert) {
      const childId = idByName.get(name)!;
      const parentId = idByName.get(ORIGINS[name])!;
      const [recipe] = await tx
        .insert(schema.recipes)
        .values({ itemId: childId, label: null, position: 0 })
        .returning({ id: schema.recipes.id });
      await tx.insert(schema.links).values({
        recipeId: recipe.id,
        itemId: null,
        type: "e",
        targetItemId: parentId,
        confidence: "established",
        isCanary: false,
      });
      console.log(`  authored: ${name} <-e- ${ORIGINS[name]}`);
    }
  });

  console.log("\nMigration complete.");
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
