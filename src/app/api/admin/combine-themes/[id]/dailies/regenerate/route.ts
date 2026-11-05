import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { requireAdminApi } from "@/lib/admin";
import { getActiveDaily } from "@/combine/daily-config-db";
import { scheduleActiveDaily } from "@/combine/daily-schedule-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Wipe days ≥ today and rebuild a 30-day schedule for the active daily.
 *  The `id` param must match the current active daily theme — the schedule
 *  is driven by the singleton daily config, not by a per-theme row.
 *
 *  This route is kept while Commit C builds the dedicated
 *  /admin/combine/daily surface. It will move there and the per-theme
 *  variant will be deleted. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;
  const themeCode = decodeURIComponent(id);

  const active = await getActiveDaily();
  if (!active) {
    return NextResponse.json(
      { error: "no_active_daily", message: "No daily config is set. Configure one before regenerating." },
      { status: 400 },
    );
  }
  if (active.themeCode !== themeCode) {
    return NextResponse.json(
      {
        error: "not_active_daily",
        message: `The active daily theme is "${active.themeCode}", not "${themeCode}". Regenerate from that theme's page.`,
      },
      { status: 400 },
    );
  }

  try {
    const live = await getLiveSnapshot();
    const result = await scheduleActiveDaily(live.snapshot, "regenerate", 30);
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
    return NextResponse.json({ error: "schedule_failed", message: msg }, { status: 400 });
  }
}
