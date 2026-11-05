import { NextResponse, type NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { normaliseDailyConfig } from "@/combine/daily-config";
import {
  clearActiveDaily,
  getActiveDaily,
  setActiveDaily,
} from "@/combine/daily-config-db";
import { readSchedule } from "@/combine/daily-schedule-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Return the current daily config + today-forward schedule + list of
 *  available themes for the picker. The schedule is empty when no daily
 *  is configured yet. */
export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const db = getDb();
  const themes = await db
    .select({ code: schema.combineThemes.code, label: schema.combineThemes.label })
    .from(schema.combineThemes)
    .orderBy(asc(schema.combineThemes.position), asc(schema.combineThemes.code));

  const active = await getActiveDaily();
  const schedule = active ? await readSchedule(active.themeCode, 30) : [];

  return NextResponse.json({ themes, active, schedule });
}

/** Set (or overwrite) the singleton daily config. Body: `{ themeCode,
 *  config }`. The config is validated via `normaliseDailyConfig`; an
 *  empty object is accepted and means "daily plays with the active theme
 *  but without caps or guests." */
export async function PUT(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const themeCode = typeof body.themeCode === "string" ? body.themeCode.trim() : "";
  if (!themeCode) {
    return NextResponse.json({ error: "theme_required" }, { status: 400 });
  }

  const db = getDb();
  const [theme] = await db
    .select({ code: schema.combineThemes.code })
    .from(schema.combineThemes)
    .where(eq(schema.combineThemes.code, themeCode))
    .limit(1);
  if (!theme) {
    return NextResponse.json({ error: "unknown_theme" }, { status: 400 });
  }

  let config;
  try {
    config = normaliseDailyConfig(body.config) ?? {};
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_daily_config", message: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  await setActiveDaily(themeCode, config);
  return NextResponse.json({ ok: true, active: { themeCode, config } });
}

/** Clear the daily config entirely. Daily runs still play, but on the
 *  active theme with no cap or guest ingredients. */
export async function DELETE() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  await clearActiveDaily();
  return NextResponse.json({ ok: true });
}
