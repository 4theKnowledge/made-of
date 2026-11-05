import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { getDb, schema } from "@/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TargetKind = "recipe" | "item";

function parseKind(raw: string | null): TargetKind | null {
  return raw === "recipe" || raw === "item" ? raw : null;
}

const MAX_IDS_PER_KIND = 200;

/** Return the signed-in user's reactions and public aggregates for a batch
 *  of recipe and/or item ids. Query shape:
 *    GET /api/combine/reactions?recipe=a,b&item=x,y
 *  Response:
 *    { recipe: {<id>: {mine: -1|1|null, up: number, down: number}},
 *      item:   {<id>: {mine: -1|1|null, up: number, down: number}} }
 *
 *  Signed-out callers get the same shape with `mine: null` everywhere. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const session = await getSession();
  const userId = session?.user.id ?? null;
  const db = getDb();

  const parseIds = (raw: string | null): string[] =>
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, MAX_IDS_PER_KIND);

  const recipeIds = parseIds(url.searchParams.get("recipe"));
  const itemIds = parseIds(url.searchParams.get("item"));

  const out = {
    recipe: {} as Record<string, { mine: -1 | 1 | null; up: number; down: number }>,
    item: {} as Record<string, { mine: -1 | 1 | null; up: number; down: number }>,
  };
  if (recipeIds.length === 0 && itemIds.length === 0) {
    return NextResponse.json(out);
  }

  // Aggregate counts via a single grouped query across both kinds.
  const idFilter = [
    recipeIds.length > 0
      ? and(
          eq(schema.reactions.targetKind, "recipe"),
          inArray(schema.reactions.targetId, recipeIds),
        )
      : null,
    itemIds.length > 0
      ? and(
          eq(schema.reactions.targetKind, "item"),
          inArray(schema.reactions.targetId, itemIds),
        )
      : null,
  ].filter((v): v is NonNullable<typeof v> => v !== null);

  const whereClause = idFilter.length === 1 ? idFilter[0] : sql`${idFilter[0]} OR ${idFilter[1]}`;

  const aggregates = await db
    .select({
      targetKind: schema.reactions.targetKind,
      targetId: schema.reactions.targetId,
      up: sql<number>`sum(case when ${schema.reactions.value} = 1 then 1 else 0 end)::int`,
      down: sql<number>`sum(case when ${schema.reactions.value} = -1 then 1 else 0 end)::int`,
    })
    .from(schema.reactions)
    .where(whereClause)
    .groupBy(schema.reactions.targetKind, schema.reactions.targetId);

  for (const row of aggregates) {
    const bucket = out[row.targetKind as TargetKind];
    bucket[row.targetId] = { mine: null, up: row.up ?? 0, down: row.down ?? 0 };
  }

  // Ensure every requested id has an entry (zeroed out when no reactions exist).
  for (const id of recipeIds) {
    out.recipe[id] ??= { mine: null, up: 0, down: 0 };
  }
  for (const id of itemIds) {
    out.item[id] ??= { mine: null, up: 0, down: 0 };
  }

  // Overlay the current user's own vote.
  if (userId) {
    const mineRows = await db
      .select({
        targetKind: schema.reactions.targetKind,
        targetId: schema.reactions.targetId,
        value: schema.reactions.value,
      })
      .from(schema.reactions)
      .where(and(eq(schema.reactions.userId, userId), whereClause));
    for (const row of mineRows) {
      const bucket = out[row.targetKind as TargetKind];
      const entry = bucket[row.targetId];
      if (!entry) continue;
      entry.mine = row.value === 1 ? 1 : -1;
    }
  }

  return NextResponse.json(out);
}

/** Record / flip / clear a reaction. Body:
 *  { targetKind: "recipe"|"item", targetId, value: -1|0|1, reason?: string }
 *  - value 1 or -1 → upsert (flip if existing).
 *  - value 0 → delete the row (toggle-off semantics).
 *  Auth required.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  let body: {
    targetKind?: unknown;
    targetId?: unknown;
    value?: unknown;
    reason?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetKind = parseKind(
    typeof body.targetKind === "string" ? body.targetKind : null,
  );
  if (!targetKind) {
    return NextResponse.json({ error: "Invalid targetKind" }, { status: 400 });
  }
  const targetId = typeof body.targetId === "string" ? body.targetId : null;
  if (!targetId) {
    return NextResponse.json({ error: "Invalid targetId" }, { status: 400 });
  }
  const rawValue = body.value;
  const value = rawValue === 1 || rawValue === -1 || rawValue === 0 ? rawValue : null;
  if (value === null) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }
  const reason =
    typeof body.reason === "string" && body.reason.length <= 1000
      ? body.reason.trim() || null
      : null;

  const db = getDb();

  if (value === 0) {
    await db
      .delete(schema.reactions)
      .where(
        and(
          eq(schema.reactions.targetKind, targetKind),
          eq(schema.reactions.targetId, targetId),
          eq(schema.reactions.userId, session.user.id),
        ),
      );
    return NextResponse.json({ ok: true, value: 0 });
  }

  // Upsert: new row or flip existing. `created_at` is preserved by the
  // DO UPDATE clause omitting it; `updated_at` is bumped to now().
  const now = new Date();
  await db
    .insert(schema.reactions)
    .values({
      targetKind,
      targetId,
      userId: session.user.id,
      value,
      reason,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.reactions.targetKind,
        schema.reactions.targetId,
        schema.reactions.userId,
      ],
      set: {
        value,
        reason: reason ?? sql`${schema.reactions.reason}`,
        updatedAt: now,
      },
    });

  return NextResponse.json({ ok: true, value });
}
