import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { getDb, schema } from "@/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Scope = "endless" | "daily";

function parseScope(raw: string | null): Scope {
  return raw === "daily" ? "daily" : "endless";
}

/** Return the signed-in user's Combine collection for the given scope as a map
 *  of itemId → epoch-ms of first discovery. The daily scope and the endless
 *  scope are fully independent so a daily puzzle starts fair even if the
 *  player has grinded a huge endless collection. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const scope = parseScope(new URL(req.url).searchParams.get("scope"));
  const db = getDb();
  const rows = await db
    .select({
      itemId: schema.combineDiscoveries.itemId,
      firstFoundAt: schema.combineDiscoveries.firstFoundAt,
    })
    .from(schema.combineDiscoveries)
    .where(
      and(
        eq(schema.combineDiscoveries.userId, session.user.id),
        eq(schema.combineDiscoveries.scope, scope),
      ),
    );

  const found: Record<string, number> = {};
  for (const r of rows) found[r.itemId] = r.firstFoundAt.getTime();
  return NextResponse.json({ found });
}

/** Record new discoveries for the given scope. Existing rows keep their
 *  original timestamp (ON CONFLICT DO NOTHING). Request body:
 *  `{ ids: string[], scope?: "endless" | "daily" }`. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  let body: { ids?: unknown; scope?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scope: Scope = body.scope === "daily" ? "daily" : "endless";
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500)
    : [];
  if (ids.length === 0) return NextResponse.json({ ok: true, added: 0 });

  const db = getDb();

  const existing = await db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(inArray(schema.items.id, ids));
  const validIds = existing.map((r) => r.id);
  if (validIds.length === 0) return NextResponse.json({ ok: true, added: 0 });

  const now = new Date();
  const result = await db
    .insert(schema.combineDiscoveries)
    .values(
      validIds.map((id) => ({
        userId: session.user.id,
        itemId: id,
        scope,
        firstFoundAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning({ itemId: schema.combineDiscoveries.itemId });

  return NextResponse.json({ ok: true, added: result.length });
}
