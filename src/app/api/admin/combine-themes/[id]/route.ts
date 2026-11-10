import { NextResponse, type NextRequest } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { invalidateRunsForTheme } from "@/combine/run-store";
import { bumpCollectionVersion } from "@/combine/theme-version";
import {
  countCompletionRowsForTheme,
  countUsersCompletedAtVersion,
} from "@/combine/completion-impact";
import { reloadSnapshot } from "@/graph/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;
  const code = decodeURIComponent(id);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Partial<typeof schema.combineThemes.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.label === "string") {
    const label = body.label.trim();
    if (!label) return NextResponse.json({ error: "label_required" }, { status: 400 });
    patch.label = label;
  }
  if ("description" in body) {
    const d = body.description as string | null;
    patch.description = d && d.trim() ? d.trim() : null;
  }
  if (typeof body.position === "number" && Number.isInteger(body.position) && body.position >= 0) {
    patch.position = body.position;
  }
  // closure_config: object | null. See src/combine/closure.ts ClosureConfig.
  if ("closure_config" in body) {
    const c = body.closure_config;
    if (c === null) {
      patch.closureConfig = null;
    } else if (typeof c === "object" && c !== null && !Array.isArray(c)) {
      patch.closureConfig = c;
    } else {
      return NextResponse.json({ error: "invalid_closure_config" }, { status: 400 });
    }
  }
  // is_published: boolean. Admin flips this when a theme is ready for
  // players. Unpublishing is non-destructive: data stays, picker hides it.
  if ("is_published" in body) {
    if (typeof body.is_published !== "boolean") {
      return NextResponse.json({ error: "invalid_is_published" }, { status: 400 });
    }
    patch.isPublished = body.is_published;
  }
  // pictogram: string (SVG inner markup) or null. 32×32 viewBox, same
  // authoring rules as items/kinds.
  if ("pictogram" in body) {
    const p = body.pictogram;
    if (p === null) patch.pictogram = null;
    else if (typeof p === "string") patch.pictogram = p.trim() || null;
    else return NextResponse.json({ error: "invalid_pictogram" }, { status: 400 });
  }
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const db = getDb();
  // T-0222: confirm-to-proceed when a closure_config change would bump
  // the collection_version and drop completed players below 100%.
  // Admins can override with `{ force: true }`. Bulk-safe:
  // over-warns when the config is semantically a no-op, which is fine.
  const force = body.force === true;
  if (!force && "closure_config" in body) {
    const [existing] = await db
      .select({ v: schema.combineThemes.collectionVersion })
      .from(schema.combineThemes)
      .where(eq(schema.combineThemes.code, code))
      .limit(1);
    const completedUsers = existing
      ? await countUsersCompletedAtVersion(db, code, existing.v)
      : 0;
    if (completedUsers > 0) {
      return NextResponse.json(
        {
          error: "confirm_required",
          reason: "closure_config_change_breaks_completions",
          completedUsers,
          message: `${completedUsers} player${completedUsers === 1 ? "" : "s"} will drop below 100% on this theme. Pass { force: true } to proceed.`,
        },
        { status: 409 },
      );
    }
  }
  const [updated] = await db
    .update(schema.combineThemes)
    .set(patch)
    .where(eq(schema.combineThemes.code, code))
    .returning();
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Closure config drives the auto-expanded set of theme members. Bump
  // when the key is present — a no-op "same shape" patch is rare enough
  // that comparing old vs new isn't worth the extra read. See T-0217.
  if ("closure_config" in body) {
    await bumpCollectionVersion(db, code);
  }
  // Only structural fields invalidate runs. label/description/position/
  // pictogram are cosmetic.
  const structural = "closure_config" in body || "is_published" in body;
  let invalidated = 0;
  if (structural) {
    await reloadSnapshot();
    invalidated = await invalidateRunsForTheme(code);
  }
  return NextResponse.json({ theme: updated, invalidatedRuns: invalidated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;
  const code = decodeURIComponent(id);
  const force = req.nextUrl.searchParams.get("force") === "1";

  const db = getDb();

  // Daily config reference is a hard block regardless of force — the
  // singleton `combine_daily_config` points at exactly one theme; let the
  // admin switch the daily theme first rather than delete the one that's
  // currently serving.
  const [daily] = await db
    .select({ theme: schema.combineDailyConfig.themeCode })
    .from(schema.combineDailyConfig)
    .limit(1);
  if (daily?.theme === code) {
    return NextResponse.json(
      {
        error: "is_active_daily",
        message: `This theme is the active Daily. Change the Daily theme first.`,
      },
      { status: 409 },
    );
  }

  const [usage] = await db
    .select({ n: count() })
    .from(schema.itemCombineThemes)
    .where(eq(schema.itemCombineThemes.themeCode, code));
  const memberCount = usage?.n ?? 0;
  const completions = await countCompletionRowsForTheme(db, code);

  if (!force && (memberCount > 0 || completions > 0)) {
    return NextResponse.json(
      {
        error: "confirm_required",
        memberCount,
        completionRows: completions,
        message: buildBlockMessage(memberCount, completions),
      },
      { status: 409 },
    );
  }

  // Force path: cascade in a transaction so a partial failure doesn't
  // leave the theme half-deleted. combine_dailies cascades by FK; we have
  // to do the restricted ones (`item_combine_themes`) plus the no-FK
  // `progress` completion rows by hand.
  await db.transaction(async (tx) => {
    if (memberCount > 0) {
      await tx
        .delete(schema.itemCombineThemes)
        .where(eq(schema.itemCombineThemes.themeCode, code));
    }
    if (completions > 0) {
      await tx
        .delete(schema.progress)
        .where(
          and(
            eq(schema.progress.kind, "combine-theme-complete"),
            eq(schema.progress.ref, code),
          ),
        );
    }
    await tx.delete(schema.combineThemes).where(eq(schema.combineThemes.code, code));
  });

  // Check after the transaction — delete returns from a tx don't surface
  // well with Drizzle's pg driver here; re-read to confirm.
  const [stillThere] = await db
    .select({ code: schema.combineThemes.code })
    .from(schema.combineThemes)
    .where(eq(schema.combineThemes.code, code))
    .limit(1);
  if (stillThere) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await reloadSnapshot();
  const invalidated = await invalidateRunsForTheme(code);
  return NextResponse.json({
    ok: true,
    invalidatedRuns: invalidated,
    deletedMembers: memberCount,
    deletedCompletions: completions,
  });
}

function buildBlockMessage(members: number, completions: number): string {
  const parts: string[] = [];
  if (members > 0) parts.push(`${members} item${members === 1 ? "" : "s"} still in this theme`);
  if (completions > 0)
    parts.push(
      `${completions} player completion stamp${completions === 1 ? "" : "s"} reference it`,
    );
  return `${parts.join(" and ")}. Pass ?force=1 to delete anyway (cascades members + completion stamps).`;
}
