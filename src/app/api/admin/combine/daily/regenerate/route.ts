import { NextResponse } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { requireAdminApi } from "@/lib/admin";
import { scheduleActiveDaily } from "@/combine/daily-schedule-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Wipe days ≥ today and rebuild a 30-day schedule for the currently
 *  active daily. The admin /admin/combine/daily page exposes this via a
 *  "Regenerate schedule" button. */
export async function POST() {
  const guard = await requireAdminApi();
  if (guard) return guard;

  try {
    const live = await getLiveSnapshot();
    const result = await scheduleActiveDaily(live.snapshot, "regenerate", 30);
    if (!result.themeCode) {
      return NextResponse.json(
        { error: "no_active_daily", message: "No daily config is set." },
        { status: 400 },
      );
    }
    return NextResponse.json({
      ok: true,
      themeCode: result.themeCode,
      written: result.written.length,
      removed: result.removed,
      skipped: result.skipped,
      unresolvedExamples: result.unresolvedExamples,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "schedule_failed", message: msg }, { status: 500 });
  }
}
