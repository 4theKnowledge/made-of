import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { requireAdminApi } from "@/lib/admin";
import { getSession } from "@/lib/session";
import { getRunOwner } from "@/lib/anon-session";
import { getDb, schema } from "@/db/client";
import { getActiveDaily } from "@/combine/daily-config-db";
import { todayKey } from "@/combine/rng";
import { limiters } from "@/api/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reset the current admin's own daily run so they can play today's daily
 *  again without waiting for UTC rollover (T-0253). Admin-only.
 *
 *  Deletes:
 *    - `combine_runs` rows owned by this admin for (mode='daily', dailyKey=today)
 *    - `progress` rows (kind='combine', result.daily=today) for this admin
 *
 *  Leaves `combine_discoveries` untouched — the collection is lifetime
 *  and per-user; a replay can still *re-make* already-discovered items
 *  without duplicating rows (PK is `(userId, itemId, scope)`).
 *
 *  Body: `{ confirmDay: string }`. Must match `todayKey()` to defend
 *  against a stale client that drifted past midnight.
 *
 *  Audit: `[admin-action] restart-daily-for-me ...` via console.warn. */
export async function POST(req: Request) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const rl = limiters.adminResetDaily.take("admin:restart-daily-for-me");
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: "Too many restart attempts. Try again shortly.",
        retryAfterMs: rl.retryAfterMs,
      },
      {
        status: 429,
        headers: { "retry-after": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  let body: { confirmDay?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const today = todayKey();
  if (typeof body.confirmDay !== "string" || body.confirmDay !== today) {
    return NextResponse.json(
      {
        error: "confirm_mismatch",
        message: `confirmDay must equal today (${today}).`,
      },
      { status: 400 },
    );
  }

  const active = await getActiveDaily();
  if (!active) {
    return NextResponse.json(
      { error: "no_active_daily", message: "No daily config is set." },
      { status: 400 },
    );
  }

  const owner = await getRunOwner();
  if (!owner) {
    // requireAdminApi above already guaranteed an authenticated admin,
    // so this is defence-in-depth rather than a reachable branch.
    return NextResponse.json(
      { error: "no_owner", message: "No session owner found." },
      { status: 401 },
    );
  }
  const db = getDb();

  const delRuns = await db
    .delete(schema.combineRuns)
    .where(
      and(
        eq(schema.combineRuns.ownerKind, owner.kind),
        eq(schema.combineRuns.ownerId, owner.id),
        eq(schema.combineRuns.mode, "daily"),
        eq(schema.combineRuns.dailyKey, today),
      ),
    )
    .returning({ id: schema.combineRuns.id });

  // progress.userId is nullable (anon progress is possible in principle).
  // Scope to the authenticated admin's userId — anon admins aren't a
  // thing, so this is safe.
  const session = await getSession();
  const actor = (session?.user as { id?: string; email?: string } | undefined)?.id ?? null;
  let delProgress: Array<{ id: string }> = [];
  if (actor) {
    delProgress = await db
      .delete(schema.progress)
      .where(
        and(
          eq(schema.progress.userId, actor),
          eq(schema.progress.kind, "combine"),
          eq(schema.progress.ref, active.themeCode),
          sql`${schema.progress.result}->>'daily' = ${today}`,
        ),
      )
      .returning({ id: schema.progress.id });
  }

  console.warn(
    `[admin-action] restart-daily-for-me themeCode=${active.themeCode} day=${today} ` +
      `ownerKind=${owner.kind} ownerId=${owner.id} actorUserId=${actor ?? "unknown"} ` +
      `deletedRuns=${delRuns.length} deletedProgress=${delProgress.length}`,
  );

  return NextResponse.json({
    ok: true,
    themeCode: active.themeCode,
    day: today,
    deletedRuns: delRuns.length,
    deletedProgress: delProgress.length,
  });
}
