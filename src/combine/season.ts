/**
 * Combine season persistence.
 *
 * Each theme stores the highest `numAges` ever promoted on `combine_season`.
 * The bundle derivation (`deriveNumAges`) enforces monotonicity against this
 * value, so a KB edit that would nominally shrink age count never does.
 *
 * Flow:
 *   loadSeason(theme) → prevNumAges
 *   buildThemeBundle(snapshot, theme, prevNumAges) → bundle (uses derived value)
 *   if bundle.theme.ages.length > prevNumAges → saveSeason(theme, newValue)
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { ThemeKey } from "./types";

export async function loadSeason(theme: ThemeKey): Promise<number> {
  const [row] = await getDb()
    .select({ numAges: schema.combineSeason.numAges })
    .from(schema.combineSeason)
    .where(eq(schema.combineSeason.theme, theme))
    .limit(1);
  return row?.numAges ?? 0;
}

export async function loadAllSeasons(): Promise<Record<ThemeKey, number>> {
  const rows = await getDb()
    .select({
      theme: schema.combineSeason.theme,
      numAges: schema.combineSeason.numAges,
    })
    .from(schema.combineSeason);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.theme] = r.numAges;
  return out as Record<ThemeKey, number>;
}

/** Upsert the stored numAges if `numAges` exceeds the current value. Returns
 *  true when a bump actually landed. */
export async function promoteSeason(
  theme: ThemeKey,
  numAges: number,
): Promise<boolean> {
  const prev = await loadSeason(theme);
  if (numAges <= prev) return false;
  await getDb()
    .insert(schema.combineSeason)
    .values({ theme, numAges })
    .onConflictDoUpdate({
      target: schema.combineSeason.theme,
      set: { numAges, promotedAt: new Date() },
    });
  return true;
}
