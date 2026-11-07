import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { getDb, schema } from "@/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Flip `hasSeenCombineTutorial = true` for the signed-in user so the
// Combine landing stops nudging them toward the tutorial on future visits.
// Anon players use a localStorage fallback (`madeof:cbtut`) — they never
// hit this endpoint.
export async function POST() {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  const db = getDb();
  await db
    .update(schema.authUser)
    .set({ hasSeenCombineTutorial: true })
    .where(eq(schema.authUser.id, session.user.id));
  return NextResponse.json({ ok: true });
}
