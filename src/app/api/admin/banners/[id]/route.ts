import { NextResponse, type NextRequest } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(schema.siteBannerStatusEnum.enumValues);
const SEVERITIES = new Set(schema.siteBannerSeverityEnum.enumValues);
const AUDIENCES = new Set(schema.siteBannerAudienceEnum.enumValues);

/** PATCH /api/admin/banners/[id] — update any subset of fields.
 *  Publishing (status→live) stamps publishedAt when unset AND atomically
 *  archives the previous live banner so the partial unique index holds. */
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
    .from(schema.siteBanners)
    .where(eq(schema.siteBanners.id, id))
    .limit(1);
  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const patch: Partial<typeof schema.siteBanners.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (typeof body.body === "string") {
    const text = body.body.trim();
    if (!text) return NextResponse.json({ error: "body_required" }, { status: 400 });
    patch.body = text;
  }

  if (typeof body.severity === "string") {
    if (!SEVERITIES.has(body.severity as schema.SiteBannerSeverity)) {
      return NextResponse.json({ error: "invalid_severity" }, { status: 400 });
    }
    patch.severity = body.severity as schema.SiteBannerSeverity;
  }

  if (typeof body.audience === "string") {
    if (!AUDIENCES.has(body.audience as schema.SiteBannerAudience)) {
      return NextResponse.json({ error: "invalid_audience" }, { status: 400 });
    }
    patch.audience = body.audience as schema.SiteBannerAudience;
  }

  if (typeof body.dismissible === "boolean") {
    patch.dismissible = body.dismissible;
  }

  for (const field of ["startsAt", "endsAt"] as const) {
    if (field in body) {
      const parsed = parseDate(body[field]);
      if (parsed === "invalid") {
        return NextResponse.json(
          { error: field === "startsAt" ? "invalid_starts_at" : "invalid_ends_at" },
          { status: 400 },
        );
      }
      patch[field] = parsed;
    }
  }

  let nextStatus: schema.SiteBannerStatus | null = null;
  if (typeof body.status === "string") {
    if (!STATUSES.has(body.status as schema.SiteBannerStatus)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }
    nextStatus = body.status as schema.SiteBannerStatus;
    patch.status = nextStatus;
    if (nextStatus === "live" && !current.publishedAt) {
      patch.publishedAt = new Date();
    }
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const updated = await db.transaction(async (tx) => {
    // If we're publishing, demote any other currently-live banner first
    // so the partial unique index on status='live' never collides.
    if (nextStatus === "live" && current.status !== "live") {
      await tx
        .update(schema.siteBanners)
        .set({ status: "archived", updatedAt: new Date() })
        .where(
          and(
            eq(schema.siteBanners.status, "live"),
            ne(schema.siteBanners.id, id),
          ),
        );
    }
    const [row] = await tx
      .update(schema.siteBanners)
      .set(patch)
      .where(eq(schema.siteBanners.id, id))
      .returning();
    return row;
  });

  return NextResponse.json({ banner: updated });
}

/** DELETE /api/admin/banners/[id] */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;

  const db = getDb();
  const [deleted] = await db
    .delete(schema.siteBanners)
    .where(eq(schema.siteBanners.id, id))
    .returning();
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

function parseDate(raw: unknown): Date | null | "invalid" {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return "invalid";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}
