import { NextResponse, type NextRequest } from "next/server";
import { inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/combine-themes/[id]/resolve
 * Body: { names: string[] }
 *
 * Resolve a list of free-form strings against item names and slugs.
 * Used by the paste-to-add flow in the theme builder. The theme id in the
 * path is accepted for symmetry but not used — resolution is global.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  await params; // theme id is unused; keep it in the URL for symmetry.

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const raw: string[] = Array.isArray(body.names)
    ? (body.names as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  if (raw.length === 0) return NextResponse.json({ matched: [], unmatched: [] });

  // Normalise: trim, lowercase (both name and slug are stored lowercase).
  // Dedup while keeping first occurrence for order-stable output.
  const seen = new Set<string>();
  const inputs: string[] = [];
  for (const line of raw) {
    const t = line.trim().toLowerCase();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    inputs.push(t);
  }
  if (inputs.length === 0) return NextResponse.json({ matched: [], unmatched: [] });

  const db = getDb();
  const rows = await db
    .select({ id: schema.items.id, name: schema.items.name, slug: schema.items.slug })
    .from(schema.items)
    .where(or(inArray(schema.items.name, inputs), inArray(schema.items.slug, inputs)));

  const byName = new Map(rows.map((r) => [r.name, r]));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  const matched: { input: string; itemId: string; name: string }[] = [];
  const unmatched: string[] = [];
  for (const input of inputs) {
    const hit = byName.get(input) ?? bySlug.get(input);
    if (hit) matched.push({ input, itemId: hit.id, name: hit.name });
    else unmatched.push(input);
  }

  return NextResponse.json({ matched, unmatched });
}
