import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { normalizeCode } from "@/lib/invites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const gate = await requireAdminApi();
  if (gate) return gate;
  const { code } = await ctx.params;
  const normalized = normalizeCode(decodeURIComponent(code));
  const db = getDb();
  const deleted = await db
    .delete(schema.codes)
    .where(eq(schema.codes.code, normalized))
    .returning();
  if (deleted.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
