import { NextResponse, type NextRequest } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_RE = /^[a-z][a-z0-9-]*$/;

/** GET /api/admin/kinds — list all kinds ordered by position. */
export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.kinds)
    .orderBy(asc(schema.kinds.position), asc(schema.kinds.code));
  return NextResponse.json({ kinds: rows });
}

/** POST /api/admin/kinds — create.
 *  Body: { code: string, label: string, description?: string | null, position?: number }
 *  code must match [a-z][a-z0-9-]* and be unique.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!code) return NextResponse.json({ error: "code_required" }, { status: 400 });
  if (!CODE_RE.test(code)) {
    return NextResponse.json(
      { error: "invalid_code", message: "code must be lowercase, start with a letter, use only a-z 0-9 -" },
      { status: 400 },
    );
  }
  if (!label) return NextResponse.json({ error: "label_required" }, { status: 400 });

  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;

  const db = getDb();
  const existing = await db
    .select({ code: schema.kinds.code })
    .from(schema.kinds)
    .where(eq(schema.kinds.code, code))
    .limit(1);
  if (existing.length) {
    return NextResponse.json({ error: "already_exists" }, { status: 409 });
  }

  let position: number;
  if (typeof body.position === "number" && Number.isInteger(body.position) && body.position >= 0) {
    position = body.position;
  } else {
    const [last] = await db
      .select({ position: schema.kinds.position })
      .from(schema.kinds)
      .orderBy(desc(schema.kinds.position))
      .limit(1);
    position = last ? last.position + 1 : 0;
  }

  const [inserted] = await db
    .insert(schema.kinds)
    .values({ code, label, description, position })
    .returning();

  return NextResponse.json({ kind: inserted }, { status: 201 });
}
