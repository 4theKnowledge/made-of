import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/feedback — list all feedback, newest first. */
export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.feedback)
    .orderBy(desc(schema.feedback.createdAt));
  return NextResponse.json({ entries: rows });
}
