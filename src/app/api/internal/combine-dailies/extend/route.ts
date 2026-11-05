import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { scheduleActiveDaily } from "@/combine/daily-schedule-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Internal endpoint: keep the active daily's schedule ≥30 days ahead of
 *  today. Called by a Railway cron job once a day.
 *
 *  Auth: the request must carry `x-cron-secret: $CRON_SECRET`. If the
 *  secret env var isn't configured, the endpoint 500s rather than opening
 *  up.
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

  try {
    const live = await getLiveSnapshot();
    const r = await scheduleActiveDaily(live.snapshot, "extend", 30);
    return NextResponse.json({
      ok: true,
      themeCode: r.themeCode,
      written: r.written.length,
      skipped: r.skipped,
      unresolvedExamples: r.unresolvedExamples,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "schedule_failed", message: msg }, { status: 500 });
  }
}
