import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { getDb, schema } from "@/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Scope = "endless" | "daily";

function parseScope(raw: string | null): Scope {
  return raw === "daily" ? "daily" : "endless";
}

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

/** Retired writer (T-0195, SECURITY_AUDIT H3b). Discoveries are now
 *  derived server-side from the replay-validated game state in
 *  `/api/combine/runs/[id]/{checkpoint,finish}`
 *  (see `src/combine/discoveries-writer.ts`).
 *
 *  Returns 410 Gone so stale clients see a clear signal. New clients
 *  don't POST at all. */
export async function POST(): Promise<Response> {
  return NextResponse.json(
    {
      error: "gone",
      detail:
        "Discoveries are written server-side from the run's replay log. See /api/combine/runs/[id]/{checkpoint,finish}.",
    },
    { status: 410 },
  );
}
