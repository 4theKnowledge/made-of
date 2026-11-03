import { NextResponse, type NextRequest } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { slug as toSlug } from "@/data/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = new Set(schema.changelogTypeEnum.enumValues);
const STATUSES = new Set(schema.changelogStatusEnum.enumValues);

/** PATCH /api/admin/changelog/[id] — update any subset of fields.
 *  Flipping status draft→live stamps publishedAt=now when it's unset.
 *  Flipping live→draft leaves publishedAt alone so re-publishing keeps the
 *  original date unless the admin clears it. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const db = getDb();
  const [current] = await db
    .select()
    .from(schema.changelogEntries)
    .where(eq(schema.changelogEntries.id, id))
    .limit(1);
  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const patch: Partial<typeof schema.changelogEntries.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });
    patch.title = title;
  }

  if (typeof body.type === "string") {
    if (!TYPES.has(body.type as schema.ChangelogType)) {
      return NextResponse.json({ error: "invalid_type" }, { status: 400 });
    }
    patch.type = body.type as schema.ChangelogType;
  }

  if (typeof body.body === "string") {
    patch.body = body.body;
  }

  if (typeof body.slug === "string") {
    const next = toSlug(body.slug);
    if (!next) return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    if (next !== current.slug) {
      const [clash] = await db
        .select({ id: schema.changelogEntries.id })
        .from(schema.changelogEntries)
        .where(
          and(
            eq(schema.changelogEntries.slug, next),
            ne(schema.changelogEntries.id, id),
          ),
        )
        .limit(1);
      if (clash) return NextResponse.json({ error: "slug_taken" }, { status: 409 });
      patch.slug = next;
    }
  }

  if (typeof body.status === "string") {
    if (!STATUSES.has(body.status as schema.ChangelogStatus)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }
    const nextStatus = body.status as schema.ChangelogStatus;
    patch.status = nextStatus;
    if (nextStatus === "live" && !current.publishedAt) {
      patch.publishedAt = new Date();
    }
  }

  if ("publishedAt" in body) {
    const raw = body.publishedAt;
    if (raw === null) {
      patch.publishedAt = null;
    } else if (typeof raw === "string") {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "invalid_published_at" }, { status: 400 });
      }
      patch.publishedAt = d;
    }
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const [updated] = await db
    .update(schema.changelogEntries)
    .set(patch)
    .where(eq(schema.changelogEntries.id, id))
    .returning();

  return NextResponse.json({ entry: updated });
}

/** DELETE /api/admin/changelog/[id] */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;

  const db = getDb();
  const [deleted] = await db
    .delete(schema.changelogEntries)
    .where(eq(schema.changelogEntries.id, id))
    .returning();
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
