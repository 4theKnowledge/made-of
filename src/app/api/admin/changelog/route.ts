import { NextResponse, type NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { slug as toSlug } from "@/data/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = new Set(schema.changelogTypeEnum.enumValues);

/** GET /api/admin/changelog — list all entries, newest first. */
export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.changelogEntries)
    .orderBy(desc(schema.changelogEntries.createdAt));
  return NextResponse.json({ entries: rows });
}

/** POST /api/admin/changelog — create a draft entry.
 *  Body: { title: string, type?: ChangelogType, body?: string, slug?: string }
 *  Slug derived from title when omitted. Status always starts as 'draft'.
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

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });

  const type =
    typeof body.type === "string" && TYPES.has(body.type as schema.ChangelogType)
      ? (body.type as schema.ChangelogType)
      : "feature";

  const markdown = typeof body.body === "string" ? body.body : "";

  const requestedSlug = typeof body.slug === "string" ? body.slug.trim() : "";
  let slugBase = requestedSlug ? toSlug(requestedSlug) : toSlug(title);
  if (!slugBase) slugBase = `entry-${Date.now()}`;

  const db = getDb();
  let slugCandidate = slugBase;
  for (let i = 2; i < 100; i++) {
    const [clash] = await db
      .select({ id: schema.changelogEntries.id })
      .from(schema.changelogEntries)
      .where(eq(schema.changelogEntries.slug, slugCandidate))
      .limit(1);
    if (!clash) break;
    slugCandidate = `${slugBase}-${i}`;
  }

  const [inserted] = await db
    .insert(schema.changelogEntries)
    .values({ title, type, body: markdown, slug: slugCandidate })
    .returning();

  return NextResponse.json({ entry: inserted }, { status: 201 });
}
