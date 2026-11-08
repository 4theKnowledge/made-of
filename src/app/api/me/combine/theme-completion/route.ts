import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getSession } from "@/lib/session";
import { getLiveSnapshot } from "@/graph/live";
import { buildThemeBundle } from "@/combine/data";
import { loadSeason } from "@/combine/season";
import { validateCompletion } from "@/combine/theme-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shape of a completion row on `progress.result`. Append-only; a
 *  re-completion against a newer collection_version inserts a fresh row. */
interface CompletionResult {
  version: number;
  itemCount: number;
}

/** GET — every completion row the signed-in user owns for the T-0217
 *  `combine-theme-complete` kind. Sorted oldest-first so the client can
 *  render a chronological journey (and pick the newest per theme by
 *  reducing). */
export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const rows = await getDb()
    .select({
      ref: schema.progress.ref,
      createdAt: schema.progress.createdAt,
      result: schema.progress.result,
    })
    .from(schema.progress)
    .where(
      and(
        eq(schema.progress.userId, session.user.id),
        eq(schema.progress.kind, "combine-theme-complete"),
      ),
    )
    .orderBy(asc(schema.progress.createdAt));

  const completions = rows.map((r) => {
    const result = (r.result ?? {}) as Partial<CompletionResult>;
    return {
      themeCode: r.ref,
      completedVersion: typeof result.version === "number" ? result.version : 0,
      completedAt: r.createdAt.toISOString(),
      itemCount: typeof result.itemCount === "number" ? result.itemCount : 0,
    };
  });

  return NextResponse.json({ completions });
}

/** POST — body { themeCode: string, version: number }. Validates the
 *  theme still has that collection_version AND the user's endless-scope
 *  discoveries cover every collectable (bundle.outputs ∪ bundle.base).
 *  Idempotent: an existing row for (user, theme, version) returns
 *  `alreadyRecorded: true` instead of appending. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const themeCode = typeof body.themeCode === "string" ? body.themeCode : "";
  const version = typeof body.version === "number" ? body.version : NaN;
  if (!themeCode) {
    return NextResponse.json({ error: "themeCode_required" }, { status: 400 });
  }
  if (!Number.isInteger(version) || version < 0) {
    return NextResponse.json({ error: "invalid_version" }, { status: 400 });
  }

  const db = getDb();
  const [theme] = await db
    .select({
      code: schema.combineThemes.code,
      collectionVersion: schema.combineThemes.collectionVersion,
    })
    .from(schema.combineThemes)
    .where(eq(schema.combineThemes.code, themeCode))
    .limit(1);
  if (!theme) return NextResponse.json({ error: "theme_not_found" }, { status: 404 });

  // Build the bundle so we know the full collectable set at the claimed
  // version. `prevNumAges` is passed through so bundling matches what the
  // player saw during their run (season-locked age count).
  const live = await getLiveSnapshot();
  const prev = await loadSeason(themeCode);
  const bundle = buildThemeBundle(live.snapshot, themeCode, prev, "endless");
  const collectables = new Set<string>([...bundle.outputs, ...bundle.base]);

  // Only need the ids overlapping the collectable set.
  const discoveries = await db
    .select({ itemId: schema.combineDiscoveries.itemId })
    .from(schema.combineDiscoveries)
    .where(
      and(
        eq(schema.combineDiscoveries.userId, session.user.id),
        eq(schema.combineDiscoveries.scope, "endless"),
        inArray(schema.combineDiscoveries.itemId, [...collectables]),
      ),
    );
  const have = new Set(discoveries.map((d) => d.itemId));

  const check = validateCompletion(collectables, have, version, theme.collectionVersion);
  if (!check.ok) {
    const status = check.reason === "version_mismatch" ? 409 : 403;
    return NextResponse.json(
      { error: check.reason, currentVersion: theme.collectionVersion, missing: check.missing },
      { status },
    );
  }

  // Idempotent: same (user, kind, ref, result.version) → no-op append.
  const [existing] = await db
    .select({ id: schema.progress.id, createdAt: schema.progress.createdAt })
    .from(schema.progress)
    .where(
      and(
        eq(schema.progress.userId, session.user.id),
        eq(schema.progress.kind, "combine-theme-complete"),
        eq(schema.progress.ref, themeCode),
        sql`${schema.progress.result}->>'version' = ${String(version)}`,
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json({
      ok: true,
      alreadyRecorded: true,
      completedVersion: version,
      itemCount: check.itemCount,
      completedAt: existing.createdAt.toISOString(),
    });
  }

  const resultValue: CompletionResult = { version, itemCount: check.itemCount };
  const [inserted] = await db
    .insert(schema.progress)
    .values({
      id: randomUUID(),
      userId: session.user.id,
      kind: "combine-theme-complete",
      ref: themeCode,
      result: resultValue,
    })
    .returning({ createdAt: schema.progress.createdAt });

  return NextResponse.json({
    ok: true,
    alreadyRecorded: false,
    completedVersion: version,
    itemCount: check.itemCount,
    completedAt: inserted.createdAt.toISOString(),
  });
}
