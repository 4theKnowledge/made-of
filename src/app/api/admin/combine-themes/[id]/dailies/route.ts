import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import { readSchedule } from "@/combine/daily-schedule-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Return the next 30 days of scheduled daily payloads for a theme. Used
 *  by the admin review table on the per-theme page. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;
  const themeCode = decodeURIComponent(id);
  const schedule = await readSchedule(themeCode, 30);
  return NextResponse.json({ schedule });
}
