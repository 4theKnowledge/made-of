import { NextResponse, type NextRequest } from "next/server";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { slug } from "@/data/load";
import type { ItemStatus, Tier, ItemKind } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/items?q=...&status=...&tier=...&limit=... — list items. */
export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const url = req.nextUrl;
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const status = url.searchParams.get("status") as ItemStatus | null;
  const tier = url.searchParams.get("tier") as Tier | null;
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 100));

  const db = getDb();
  const conds = [];
  if (q) {
    conds.push(
      or(
        ilike(schema.items.name, `%${q}%`),
        ilike(schema.items.slug, `%${q}%`),
      ),
    );
  }
  if (status) conds.push(eq(schema.items.status, status));
  if (tier) conds.push(eq(schema.items.tier, tier));

  const rows = await db
    .select({
      id: schema.items.id,
      name: schema.items.name,
      tier: schema.items.tier,
      kind: schema.items.kind,
      status: schema.items.status,
      isCanary: schema.items.isCanary,
      updatedAt: schema.items.updatedAt,
    })
    .from(schema.items)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.items.updatedAt), asc(schema.items.id))
    .limit(limit);

  return NextResponse.json({ items: rows });
}

/** POST /api/admin/items — create a new draft item.
 *  Body: { name, tier, kind, firstAppeared?, symbol?, fact?, tags? } */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const tier = body.tier as Tier | undefined;
  const kind = body.kind as ItemKind | undefined;
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (!tier) return NextResponse.json({ error: "tier_required" }, { status: 400 });
  if (!kind) return NextResponse.json({ error: "kind_required" }, { status: 400 });

  const itemSlug = slug(name);
  if (!itemSlug) return NextResponse.json({ error: "bad_slug" }, { status: 400 });

  const db = getDb();
  const existing = await db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(eq(schema.items.slug, itemSlug))
    .limit(1);
  if (existing.length) {
    return NextResponse.json(
      { error: "already_exists", slug: itemSlug },
      { status: 409 },
    );
  }

  const [inserted] = await db
    .insert(schema.items)
    .values({
      slug: itemSlug,
      name: name.toLowerCase(),
      tier,
      kind,
      firstAppeared: (body.firstAppeared as string | null) ?? null,
      firstAppearedYa: null,
      symbol: (body.symbol as string | null) ?? null,
      fact: (body.fact as string | undefined) ?? "",
      status: "draft",
      isCanary: false,
      tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
    })
    .returning({ id: schema.items.id });

  return NextResponse.json({ id: inserted.id, slug: itemSlug }, { status: 201 });
}
