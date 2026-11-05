import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { getDb, schema } from "@/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Scope = "endless" | "daily";

function parseScope(raw: string | null): Scope {
  return raw === "daily" ? "daily" : "endless";
}

/** Max signatures per (user, item, scope). Admin edits could keep minting
 *  variants; capping bounds row size. In practice an item has <10 variants. */
const MAX_SIGS_PER_ITEM = 32;

/** Return the signed-in user's Combine collection for the given scope as a
 *  map of itemId → epoch-ms of first discovery, plus the per-item set of
 *  recipe signatures used (powering the mastery tier). Scopes stay
 *  independent so a daily puzzle isn't walked in with endless progress. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const scope = parseScope(new URL(req.url).searchParams.get("scope"));
  const db = getDb();
  const rows = await db
    .select({
      itemId: schema.combineDiscoveries.itemId,
      firstFoundAt: schema.combineDiscoveries.firstFoundAt,
      recipeSignatures: schema.combineDiscoveries.recipeSignatures,
    })
    .from(schema.combineDiscoveries)
    .where(
      and(
        eq(schema.combineDiscoveries.userId, session.user.id),
        eq(schema.combineDiscoveries.scope, scope),
      ),
    );

  const found: Record<string, number> = {};
  const signatures: Record<string, string[]> = {};
  for (const r of rows) {
    found[r.itemId] = r.firstFoundAt.getTime();
    if (r.recipeSignatures.length > 0) signatures[r.itemId] = r.recipeSignatures;
  }
  return NextResponse.json({ found, signatures });
}

/** Record new discoveries for the given scope. Existing rows keep their
 *  original firstFoundAt but merge incoming signatures (deduped, capped).
 *  Request body: `{ ids: string[], scope?: Scope, signatures?: Record<string, string[]> }`.
 *
 *  `signatures[itemId]` is the sorted-ingredient variants the player has
 *  made for `itemId` in this batch. Ids without a sig entry are "unlock
 *  only" (base-ingredient leaks, old clients) — row inserted with `[]`. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  let body: { ids?: unknown; scope?: unknown; signatures?: unknown };
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

  // Parse signatures map defensively — a bad client should never crash the
  // route. Any id that doesn't survive validation falls back to "unlock only".
  const rawSigs = body.signatures;
  const sigsByItem = new Map<string, string[]>();
  if (rawSigs && typeof rawSigs === "object" && !Array.isArray(rawSigs)) {
    for (const [id, val] of Object.entries(rawSigs as Record<string, unknown>)) {
      if (typeof id !== "string") continue;
      if (!Array.isArray(val)) continue;
      const clean = val
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .slice(0, MAX_SIGS_PER_ITEM);
      if (clean.length > 0) sigsByItem.set(id, clean);
    }
  }

  const db = getDb();

  const existing = await db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(inArray(schema.items.id, ids));
  const validIds = existing.map((r) => r.id);
  if (validIds.length === 0) return NextResponse.json({ ok: true, added: 0 });

  const now = new Date();
  const rows = validIds.map((id) => ({
    userId: session.user.id,
    itemId: id,
    scope,
    firstFoundAt: now,
    recipeSignatures: sigsByItem.get(id) ?? [],
  }));

  // Merge-on-conflict: keep the row's original firstFoundAt (no update on
  // that column), union the existing signatures with the incoming ones,
  // dedupe, cap at MAX_SIGS_PER_ITEM. Returning only counts freshly-inserted
  // rows because the ON CONFLICT path still returns one row per upserted
  // record — callers just use the count as "touched", not "newly unlocked".
  const result = await db
    .insert(schema.combineDiscoveries)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        schema.combineDiscoveries.userId,
        schema.combineDiscoveries.itemId,
        schema.combineDiscoveries.scope,
      ],
      set: {
        recipeSignatures: sql`(
          SELECT COALESCE(array_agg(s), ARRAY[]::text[])
          FROM (
            SELECT DISTINCT s
            FROM unnest(${schema.combineDiscoveries.recipeSignatures} || excluded.recipe_signatures) AS s
            LIMIT ${MAX_SIGS_PER_ITEM}
          ) AS merged
        )`,
      },
    })
    .returning({ itemId: schema.combineDiscoveries.itemId });

  return NextResponse.json({ ok: true, added: result.length });
}
