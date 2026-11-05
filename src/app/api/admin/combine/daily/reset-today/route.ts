import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getLiveSnapshot } from "@/graph/live";
import { requireAdminApi } from "@/lib/admin";
import { getSession } from "@/lib/session";
import { getDb, schema } from "@/db/client";
import { resetTodaySchedule } from "@/combine/daily-schedule-db";
import { todayKey } from "@/combine/rng";
import { limiters } from "@/api/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reset today's daily puzzle for the currently active theme.
 *
 *  Destructive. Overwrites the `combine_dailies` row for today, which
 *  invalidates every in-flight run save client-side (they'll resume to a
 *  different seed/tray when the player refreshes). Optional
 *  `wipeResults` flag also deletes finished `progress` rows for today —
 *  used when the admin needs to clear a corrupted leaderboard, not for
 *  routine reruns. Never touches `combine_discoveries` (collection is
 *  lifetime).
 *
 *  Body: `{ confirmDay: string, wipeResults?: boolean }`.
 *  `confirmDay` must match the server's `todayKey()` — defends against a
 *  client that drifted past midnight mid-UAT.
 *
 *  Audit: writes a `[admin-action] reset-today ...` line via `console.warn`
 *  so Railway log aggregation captures the actor + payload. A structured
 *  audit table is a future task.
 */
export async function POST(req: Request) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  // Rate limit: admin-wide bucket. Admins share one key so a double-click
  // or a frantic retry gets throttled; a deliberate second reset in the
  // same minute will still succeed on the next refill.
  const rl = limiters.adminResetDaily.take("admin:reset-today");
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many reset attempts. Try again shortly.", retryAfterMs: rl.retryAfterMs },
      { status: 429, headers: { "retry-after": Math.ceil(rl.retryAfterMs / 1000).toString() } },
    );
  }

  let body: { confirmDay?: unknown; wipeResults?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const today = todayKey();
  if (typeof body.confirmDay !== "string" || body.confirmDay !== today) {
    return NextResponse.json(
      { error: "confirm_mismatch", message: `confirmDay must equal today (${today}).` },
      { status: 400 },
    );
  }
  const wipeResults = body.wipeResults === true;

  try {
    const live = await getLiveSnapshot();
    const result = await resetTodaySchedule(live.snapshot);
    if (!result) {
      return NextResponse.json(
        { error: "no_active_daily", message: "No daily config is set." },
        { status: 400 },
      );
    }

    let deletedResults = 0;
    if (wipeResults) {
      const del = await getDb()
        .delete(schema.progress)
        .where(
          and(
            eq(schema.progress.kind, "combine"),
            eq(schema.progress.ref, result.themeCode),
            sql`${schema.progress.result}->>'daily' = ${today}`,
          ),
        )
        .returning({ id: schema.progress.id });
      deletedResults = del.length;
    }

    // Audit line — picked up by Railway log aggregation. Keep the shape
    // grep-friendly: `[admin-action] <verb> key=value ...`.
    const session = await getSession();
    const actor = (session?.user as { id?: string; email?: string } | undefined)?.id ?? "unknown";
    console.warn(
      `[admin-action] reset-today themeCode=${result.themeCode} day=${today} ` +
        `wipeResults=${wipeResults} deletedResults=${deletedResults} actorUserId=${actor}`,
    );

    return NextResponse.json({
      ok: true,
      themeCode: result.themeCode,
      day: today,
      payload: result.payload,
      unresolvedExamples: result.unresolvedExamples,
      deletedResults,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "reset_failed", message: msg }, { status: 500 });
  }
}
