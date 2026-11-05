import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { requireAdminApi } from "@/lib/admin";
import { scheduleTheme } from "@/combine/daily-schedule-db";
import type { ThemeKey } from "@/combine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Wipe days ≥ today and rebuild a 30-day schedule for the theme. The
 *  admin Combine → theme page exposes this via a "Regenerate schedule"
 *  button. Response includes a small `unresolvedExamples` sample so the
 *  admin can spot guest outputs that have no path through the capped
 *  bundle and fix the config. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;
  const themeCode = decodeURIComponent(id);

  try {
    const live = await getLiveSnapshot();
    const result = await scheduleTheme(
      live.snapshot,
      themeCode as ThemeKey,
      "regenerate",
      30,
    );
    return NextResponse.json({
      ok: true,
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
