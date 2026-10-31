import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { getDb, schema } from "@/db/client";

export async function DELETE() {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const db = getDb();
  await db.delete(schema.authUser).where(eq(schema.authUser.id, session.user.id));
  // Session and account rows cascade via FK.

  return NextResponse.json({ ok: true });
}
