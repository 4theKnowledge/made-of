import { NextResponse, type NextRequest } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEVERITIES = new Set(schema.siteBannerSeverityEnum.enumValues);
const AUDIENCES = new Set(schema.siteBannerAudienceEnum.enumValues);

/** GET /api/admin/banners — list all banners, newest first. */
export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.siteBanners)
    .orderBy(desc(schema.siteBanners.createdAt));
  return NextResponse.json({ banners: rows });
}

/** POST /api/admin/banners — create a draft banner.
 *  Body: { body: string, severity?, audience?, dismissible?, startsAt?, endsAt? }
 *  Status always starts as 'draft'. */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "body_required" }, { status: 400 });

  const severity =
    typeof body.severity === "string" &&
    SEVERITIES.has(body.severity as schema.SiteBannerSeverity)
      ? (body.severity as schema.SiteBannerSeverity)
      : "info";

  const audience =
    typeof body.audience === "string" &&
    AUDIENCES.has(body.audience as schema.SiteBannerAudience)
      ? (body.audience as schema.SiteBannerAudience)
      : "everyone";

  const dismissible =
    typeof body.dismissible === "boolean" ? body.dismissible : true;

  const startsAt = parseDate(body.startsAt);
  if (startsAt === "invalid") {
    return NextResponse.json({ error: "invalid_starts_at" }, { status: 400 });
  }
  const endsAt = parseDate(body.endsAt);
  if (endsAt === "invalid") {
    return NextResponse.json({ error: "invalid_ends_at" }, { status: 400 });
  }

  const db = getDb();
  const [inserted] = await db
    .insert(schema.siteBanners)
    .values({
      body: text,
      severity,
      audience,
      dismissible,
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
    })
    .returning();

  return NextResponse.json({ banner: inserted }, { status: 201 });
}

function parseDate(raw: unknown): Date | null | "invalid" {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return "invalid";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}
