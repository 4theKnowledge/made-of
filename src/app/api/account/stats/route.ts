import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { loadAccountStats } from "@/lib/stats/load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  const stats = await loadAccountStats(session.user.id);
  return NextResponse.json(stats);
}
