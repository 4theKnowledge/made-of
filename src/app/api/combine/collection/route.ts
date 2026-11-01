import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { getDb, schema } from "@/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Return the signed-in user's lifetime Combine collection as a map of
 *  itemId → ISO timestamp of first discovery. */
export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const db = getDb();
  const rows = await db
    .select({
      itemId: schema.combineDiscoveries.itemId,
      firstFoundAt: schema.combineDiscoveries.firstFoundAt,
    })
    .from(schema.combineDiscoveries)
    .where(eq(schema.combineDiscoveries.userId, session.user.id));

  const found: Record<string, number> = {};
  for (const r of rows) found[r.itemId] = r.firstFoundAt.getTime();
  return NextResponse.json({ found });
}

/** Record new discoveries. Existing rows keep their original timestamp
 *  (ON CONFLICT DO NOTHING). The server stamps the time; the client never
 *  dictates it. Request body: `{ ids: string[] }`. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500)
    : [];
  if (ids.length === 0) return NextResponse.json({ ok: true, added: 0 });

  const db = getDb();

  // Keep ids that actually exist in `items` so bad inputs can't poison the
  // table; the FK would reject them anyway, but filtering first lets us
  // batch-insert without aborting on the first invalid row.
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
        firstFoundAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning({ itemId: schema.combineDiscoveries.itemId });

  return NextResponse.json({ ok: true, added: result.length });
}
