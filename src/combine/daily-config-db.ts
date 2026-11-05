/**
 * DB access for the singleton `combine_daily_config` row. The daily mode
 * is a top-level concept: at any moment there is exactly one "daily
 * theme" with one config. This module hides that fact from callers who
 * just want "what's the current daily config?".
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { DailyConfig } from "./daily-config";
import type { ThemeKey } from "./types";

export interface ActiveDaily {
  themeCode: ThemeKey;
  config: DailyConfig;
}

/** Fetch the current daily config, or null if none has been set yet. */
export async function getActiveDaily(): Promise<ActiveDaily | null> {
  const db = getDb();
  const [row] = await db
    .select({
      themeCode: schema.combineDailyConfig.themeCode,
      config: schema.combineDailyConfig.config,
    })
    .from(schema.combineDailyConfig)
    .where(eq(schema.combineDailyConfig.id, "current"))
    .limit(1);
  if (!row) return null;
  return {
    themeCode: row.themeCode as ThemeKey,
    config: row.config as DailyConfig,
  };
}

/** Upsert the current daily config. The table is a singleton (PK = 'current'),
 *  so this either inserts the first row or overwrites the existing one. */
export async function setActiveDaily(
  themeCode: string,
  config: DailyConfig,
): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.combineDailyConfig)
    .values({ id: "current", themeCode, config, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.combineDailyConfig.id,
      set: { themeCode, config, updatedAt: new Date() },
    });
}

/** Clear the daily config entirely. Daily runs still *play*, but the
 *  bundle is identical to the active theme's endless bundle (no cap, no
 *  guest ingredient). Mostly useful during dev. */
export async function clearActiveDaily(): Promise<void> {
  const db = getDb();
  await db.delete(schema.combineDailyConfig).where(eq(schema.combineDailyConfig.id, "current"));
}
