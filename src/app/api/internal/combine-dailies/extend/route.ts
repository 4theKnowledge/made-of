import { NextResponse, type NextRequest } from "next/server";
import { eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getLiveSnapshot } from "@/graph/live";
import { scheduleTheme } from "@/combine/daily-schedule-db";
import type { ThemeKey } from "@/combine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Internal endpoint: ensure every theme with a `dailyConfig` has at
 *  least 30 days of schedule ahead of today. Called by a Railway cron
 *  job once a day.
 *
 *  Auth: the request must carry `x-cron-secret: $CRON_SECRET`. The secret
 *  is configured as a Railway environment variable; if it's missing, the
 *  endpoint 500s rather than opening up.
 *
 *  Uses mode: "extend" so existing scheduled days aren't disturbed. Admin
 *  must click "Regenerate" to wipe + reroll days ≥ today. */
export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "cron_secret_unset", message: "CRON_SECRET env var is not set on the server" },
      { status: 500 },
    );
  }
  const got = req.headers.get("x-cron-secret");
  if (got !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const themes = await db
    .select({ code: schema.combineThemes.code })
    .from(schema.combineThemes)
    .where(isNotNull(schema.combineThemes.dailyConfig));
  // `.where(isNotNull(...))` matches rows where dailyConfig is not SQL
  // null. An empty JSON object ({}) would still match, but `scheduleTheme`
  // short-circuits when the resolved config has no fields. Belt and
  // braces — the no-op cost is one row read.
  void eq; // used nowhere else; kept to keep the import tree stable

  const results: Array<{
    theme: string;
    written: number;
    skipped: number;
    unresolvedExamples: string[];
  }> = [];

  const live = await getLiveSnapshot();
  for (const theme of themes) {
    try {
      const r = await scheduleTheme(
        live.snapshot,
        theme.code as ThemeKey,
        "extend",
        30,
      );
      results.push({
        theme: theme.code,
        written: r.written.length,
        skipped: r.skipped,
        unresolvedExamples: r.unresolvedExamples,
      });
    } catch (err) {
      results.push({
        theme: theme.code,
        written: 0,
        skipped: 0,
        unresolvedExamples: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  return NextResponse.json({ ok: true, themes: results });
}
