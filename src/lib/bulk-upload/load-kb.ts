/**
 * Load the DB projection the planner needs. One trip to Postgres per plan
 * request; `buildPlan` is pure from here on.
 */

import { getDb, schema } from "@/db/client";
import type { KbIndex } from "./types";

export async function loadKbIndex(): Promise<KbIndex> {
  const db = getDb();
  const [items, sources, kinds] = await Promise.all([
    db
      .select({ id: schema.items.id, slug: schema.items.slug, name: schema.items.name })
      .from(schema.items),
    db.select({ code: schema.sources.code }).from(schema.sources),
    db.select({ code: schema.kinds.code }).from(schema.kinds),
  ]);

  const itemByName = new Map<string, { id: string; slug: string; name: string }>();
  const itemBySlug = new Map<string, { id: string; slug: string; name: string }>();
  for (const i of items) {
    itemByName.set(i.name, i);
    itemBySlug.set(i.slug, i);
  }

  return {
    itemByName,
    itemBySlug,
    existingSourceCodes: new Set(sources.map((s) => s.code)),
    existingKindCodes: new Set(kinds.map((k) => k.code)),
  };
}
