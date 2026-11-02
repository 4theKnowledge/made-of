import { randomBytes } from "crypto";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { normalizeCode } from "@/lib/invites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CodeKind = "invite" | "promo";

/**
 * Mint a short, mouth-friendly code: 4-char groups of base32-ish alphabet,
 * no ambiguous letters (0/O, 1/I/L). We join with a hyphen so it's easy
 * to read over voice. Default length is one group (4 chars), extended by
 * `len` groups.
 */
function mint(groups = 2): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const buf = randomBytes(groups * 4);
  const chars: string[] = [];
  for (let i = 0; i < groups; i++) {
    for (let j = 0; j < 4; j++) {
      chars.push(alphabet[buf[i * 4 + j] % alphabet.length]);
    }
    if (i < groups - 1) chars.push("-");
  }
  return chars.join("");
}

export async function GET() {
  const gate = await requireAdminApi();
  if (gate) return gate;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.codes)
    .orderBy(desc(schema.codes.createdAt));
  return NextResponse.json({ codes: rows });
}

export async function POST(req: Request) {
  const gate = await requireAdminApi();
  if (gate) return gate;

  const body = (await req.json().catch(() => ({}))) as {
    code?: string;
    kind?: CodeKind;
    maxUses?: number | null;
    expiresAt?: string | null;
    note?: string | null;
    count?: number;
  };

  const kind: CodeKind = body.kind === "promo" ? "promo" : "invite";
  const maxUses =
    body.maxUses === null || body.maxUses === undefined
      ? kind === "invite"
        ? 1
        : null
      : Math.max(1, Math.floor(body.maxUses));
  const expiresAt =
    body.expiresAt && body.expiresAt.length > 0
      ? new Date(body.expiresAt)
      : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json({ error: "invalid expiresAt" }, { status: 400 });
  }
  const note = body.note?.trim() || null;

  const count = body.count ? Math.max(1, Math.min(50, body.count)) : 1;
  const explicit = body.code ? normalizeCode(body.code) : "";

  if (explicit && count > 1) {
    return NextResponse.json(
      { error: "can't bulk-mint with an explicit code" },
      { status: 400 },
    );
  }

  const db = getDb();
  const toInsert = [] as Array<{
    code: string;
    kind: CodeKind;
    maxUses: number | null;
    expiresAt: Date | null;
    note: string | null;
  }>;
  if (explicit) {
    toInsert.push({ code: explicit, kind, maxUses, expiresAt, note });
  } else {
    for (let i = 0; i < count; i++) {
      toInsert.push({ code: mint(2), kind, maxUses, expiresAt, note });
    }
  }

  try {
    const inserted = await db
      .insert(schema.codes)
      .values(toInsert)
      .returning();
    return NextResponse.json({ codes: inserted });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not create codes.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
