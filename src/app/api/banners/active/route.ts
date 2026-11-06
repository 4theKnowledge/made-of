import { NextResponse } from "next/server";
import { and, eq, isNull, lte, gte, or } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/banners/active — the single banner that should render for this
 *  caller right now, or null. Filters on status=live, time window, and
 *  audience vs. the caller's session. */
export async function GET() {
  const session = await getSession();
  const signedIn = Boolean(session);
  const isAdmin =
    (session?.user as { role?: string } | undefined)?.role === "admin";

  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select()
    .from(schema.siteBanners)
    .where(
      and(
        eq(schema.siteBanners.status, "live"),
        or(isNull(schema.siteBanners.startsAt), lte(schema.siteBanners.startsAt, now)),
        or(isNull(schema.siteBanners.endsAt), gte(schema.siteBanners.endsAt, now)),
      ),
    )
    .limit(1);

  if (!row) return NextResponse.json({ banner: null });

  // Audience gate. Keep the unique-live guarantee in the DB, so the only
  // question here is whether *this caller* should see the one live banner.
  const audienceOk =
    row.audience === "everyone" ||
    (row.audience === "signed_in" && signedIn) ||
    (row.audience === "signed_out" && !signedIn) ||
    (row.audience === "admins_only" && isAdmin);

  if (!audienceOk) return NextResponse.json({ banner: null });

  return NextResponse.json({
    banner: {
      id: row.id,
      body: row.body,
      severity: row.severity,
      dismissible: row.dismissible,
    },
  });
}
