// Server-side loader for the /account/combine run-history page. Returns
// finished Combine runs for a user, newest-first, with the theme label
// resolved via a left-join (deleted themes still render under their code).
//
// Filtering happens in-memory: the dataset per user is small (a motivated
// player might have hundreds of rows, not millions), and the result JSONB
// is where `mode` lives — which would need a jsonb path op to filter in
// SQL. Keeping it in TS lets the page swap filter chips without a
// round-trip too.

import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

export type CombineRunMode = "endless" | "fast" | "daily" | "classic";

export type CombineRunHistoryRow = {
  id: string;
  theme: string;
  themeLabel: string;
  createdAt: Date;
  score: number;
  made: number;
  mode: CombineRunMode;
  chapter: number | null;
  season: number | null;
  daily: string | null;
  engineVersion: number | null;
};

export async function loadCombineRunHistory(
  userId: string,
  limit = 50,
): Promise<CombineRunHistoryRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: schema.progress.id,
      theme: schema.progress.ref,
      createdAt: schema.progress.createdAt,
      result: schema.progress.result,
      themeLabel: schema.combineThemes.label,
    })
    .from(schema.progress)
    .leftJoin(
      schema.combineThemes,
      eq(schema.progress.ref, schema.combineThemes.code),
    )
    .where(
      and(
        eq(schema.progress.userId, userId),
        eq(schema.progress.kind, "combine"),
      ),
    )
    .orderBy(desc(schema.progress.createdAt))
    .limit(limit);

  return rows
    .map((r): CombineRunHistoryRow | null => {
      const result = (r.result ?? {}) as Partial<{
        score: number;
        made: number;
        mode: CombineRunMode;
        chapter: number;
        // Legacy field name before the "age → chapter" rename.
        age: number;
        season: number;
        daily: string;
        engineVersion: number;
      }>;
      if (typeof result.score !== "number") return null;
      const mode = normalizeMode(result.mode);
      const chapter =
        typeof result.chapter === "number"
          ? result.chapter
          : typeof result.age === "number"
            ? result.age
            : null;
      return {
        id: r.id,
        theme: r.theme,
        themeLabel: r.themeLabel ?? r.theme,
        createdAt: r.createdAt,
        score: result.score,
        made: typeof result.made === "number" ? result.made : 0,
        mode,
        chapter,
        season: typeof result.season === "number" ? result.season : null,
        daily: typeof result.daily === "string" ? result.daily : null,
        engineVersion:
          typeof result.engineVersion === "number" ? result.engineVersion : null,
      };
    })
    .filter((x): x is CombineRunHistoryRow => x !== null);
}

// Legacy rows written before the Fast/Daily split used `"classic"` as the
// mode. Pre-mode rows have no mode at all. Collapse both to endless for
// display so the filter chips don't need a legacy option.
function normalizeMode(raw: unknown): CombineRunMode {
  if (raw === "fast" || raw === "daily") return raw;
  return "endless";
}
