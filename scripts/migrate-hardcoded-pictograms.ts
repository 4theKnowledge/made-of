/**
 * One-shot migration: copy the hardcoded PICTO / KIND_PICTO maps from
 * `src/pictograms/data.ts` into the DB (`items.pictogram`, `kinds.pictogram`).
 *
 * Why: `Pictogram.tsx` has historically fallen back through four layers,
 * two of them in-code. That meant `items.pictogram IS NULL` didn't mean
 * "no pictogram visible" — it often meant "the visible pictogram is
 * sourced from code, not DB." The admin audit page, the "download missing"
 * endpoint, and every user-visible count were skewed by the hidden layer.
 *
 * After this migration lands, the follow-up change strips the in-code
 * layers from `Pictogram.tsx`. DB becomes the single source of truth.
 *
 * Idempotent. Only updates rows where `pictogram IS NULL`. Running twice
 * (or against a partially-migrated DB) is a no-op for already-populated
 * rows. Transactional per table.
 *
 * Usage:
 *   npx tsx scripts/migrate-hardcoded-pictograms.ts            # run
 *   npx tsx scripts/migrate-hardcoded-pictograms.ts --dry-run  # report only
 *
 * In prod (Railway one-off): the compiled bundle lives at
 * `dist-scripts/migrate-hardcoded-pictograms.js`; run with `node`.
 */

import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../src/db/client";
import { KIND_PICTO, PICTO } from "../src/pictograms/data";

const DRY_RUN = process.argv.includes("--dry-run");

async function migrateItems(): Promise<{
  updated: number;
  skippedExisting: number;
  missingFromMap: string[];
}> {
  const db = getDb();
  const picto = PICTO as Record<string, string>;

  const rows = await db
    .select({
      id: schema.items.id,
      name: schema.items.name,
      pictogram: schema.items.pictogram,
    })
    .from(schema.items);

  const skippedExisting = rows.filter((r) => r.pictogram != null).length;
  const needsBackfill = rows.filter((r) => r.pictogram == null);
  const missingFromMap: string[] = [];
  let updated = 0;

  if (DRY_RUN) {
    for (const row of needsBackfill) {
      const svg = picto[row.name];
      if (svg) updated += 1;
      else missingFromMap.push(row.name);
    }
    return { updated, skippedExisting, missingFromMap };
  }

  await db.transaction(async (tx) => {
    for (const row of needsBackfill) {
      const svg = picto[row.name];
      if (!svg) {
        missingFromMap.push(row.name);
        continue;
      }
      // Guard the write with `isNull` so a concurrent writer can't be
      // clobbered between the read above and this update.
      const res = await tx
        .update(schema.items)
        .set({ pictogram: svg })
        .where(and(eq(schema.items.id, row.id), isNull(schema.items.pictogram)))
        .returning({ id: schema.items.id });
      if (res.length > 0) updated += 1;
    }
  });

  return { updated, skippedExisting, missingFromMap };
}

async function migrateKinds(): Promise<{
  updated: number;
  skippedExisting: number;
  missingFromMap: string[];
}> {
  const db = getDb();
  const kindPicto = KIND_PICTO as Record<string, string>;

  const rows = await db
    .select({
      code: schema.kinds.code,
      pictogram: schema.kinds.pictogram,
    })
    .from(schema.kinds);

  const skippedExisting = rows.filter((r) => r.pictogram != null).length;
  const needsBackfill = rows.filter((r) => r.pictogram == null);
  const missingFromMap: string[] = [];
  let updated = 0;

  if (DRY_RUN) {
    for (const row of needsBackfill) {
      const svg = kindPicto[row.code];
      if (svg) updated += 1;
      else missingFromMap.push(row.code);
    }
    return { updated, skippedExisting, missingFromMap };
  }

  await db.transaction(async (tx) => {
    for (const row of needsBackfill) {
      const svg = kindPicto[row.code];
      if (!svg) {
        missingFromMap.push(row.code);
        continue;
      }
      const res = await tx
        .update(schema.kinds)
        .set({ pictogram: svg })
        .where(
          and(eq(schema.kinds.code, row.code), isNull(schema.kinds.pictogram)),
        )
        .returning({ code: schema.kinds.code });
      if (res.length > 0) updated += 1;
    }
  });

  return { updated, skippedExisting, missingFromMap };
}

async function main() {
  const prefix = DRY_RUN ? "[dry-run]" : "[write]";
  console.log(`${prefix} migrating hardcoded pictograms into DB…`);

  const items = await migrateItems();
  console.log(
    `${prefix} items: ${items.updated} would be updated, ${items.skippedExisting} already had a value, ${items.missingFromMap.length} items had no PICTO entry.`,
  );
  if (items.missingFromMap.length > 0 && items.missingFromMap.length <= 50) {
    console.log(`${prefix}   items without a PICTO entry (truly missing):`);
    for (const name of items.missingFromMap) console.log(`    - ${name}`);
  } else if (items.missingFromMap.length > 50) {
    console.log(
      `${prefix}   items without a PICTO entry (truly missing): ${items.missingFromMap.length} — too many to list; dump via /api/admin/pictograms/missing after this migration.`,
    );
  }

  const kinds = await migrateKinds();
  console.log(
    `${prefix} kinds: ${kinds.updated} would be updated, ${kinds.skippedExisting} already had a value, ${kinds.missingFromMap.length} kinds had no KIND_PICTO entry.`,
  );
  if (kinds.missingFromMap.length > 0) {
    console.log(`${prefix}   kinds without a KIND_PICTO entry:`);
    for (const code of kinds.missingFromMap) console.log(`    - ${code}`);
  }

  console.log(`${prefix} done.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
