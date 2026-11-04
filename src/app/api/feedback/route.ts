import { NextResponse, type NextRequest } from "next/server";
import { getDb, schema } from "@/db/client";
import { getSession } from "@/lib/session";
import { limiters, visitorKey, withRateLimit } from "@/api/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = new Set(schema.feedbackTypeEnum.enumValues);
const MAX_NOTE = 4000;
const MAX_URL = 1000;

/** POST /api/feedback — submit user feedback.
 *  Body: { type: FeedbackType, payload: object, url?: string }
 *
 *  `suggest_recipe` requires a signed-in user; the rest allow anonymous.
 *  All submissions are rate-limited via `limiters.reports` (10/hour per IP).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  const userId = session?.user?.id ?? null;
  const key = userId ? `user:${userId}` : visitorKey(req);

  return withRateLimit(req, limiters.reports, key, async () => {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const type = typeof body.type === "string" ? body.type : "";
    if (!TYPES.has(type as schema.FeedbackType)) {
      return NextResponse.json({ error: "invalid_type" }, { status: 400 });
    }

    if (type === "suggest_recipe" && !userId) {
      return NextResponse.json({ error: "auth_required" }, { status: 401 });
    }

    const payload = normalisePayload(type as schema.FeedbackType, body.payload);
    if (!payload) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }

    let url: string | null = null;
    if (typeof body.url === "string" && body.url.trim()) {
      url = body.url.trim().slice(0, MAX_URL);
    }

    const db = getDb();
    const [inserted] = await db
      .insert(schema.feedback)
      .values({
        type: type as schema.FeedbackType,
        payload,
        userId,
        url,
      })
      .returning({ id: schema.feedback.id });

    // TODO track() — once typed PostHog helper lands (T-0057): emit
    // `feedback_submitted` with { type, hasUser: !!userId }.

    return NextResponse.json({ ok: true, id: inserted.id }, { status: 201 });
  });
}

/** Validate/clean payload per type. Returns the stored object, or null when
 *  the shape doesn't meet the minimum (e.g. empty note on `other`). */
function normalisePayload(
  type: schema.FeedbackType,
  raw: unknown,
): Record<string, unknown> | null {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const str = (v: unknown, max = MAX_NOTE): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    if (!t) return undefined;
    return t.slice(0, max);
  };

  const strList = (v: unknown, cap = 8): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out: string[] = [];
    for (const item of v) {
      if (typeof item !== "string") continue;
      const t = item.trim();
      if (t) out.push(t.slice(0, 200));
      if (out.length >= cap) break;
    }
    return out.length ? out : undefined;
  };

  if (type === "suggest_item") {
    const name = str(p.name, 200);
    if (!name) return null;
    const context = str(p.context);
    return context ? { name, context } : { name };
  }

  if (type === "suggest_recipe") {
    const inputs = strList(p.inputs);
    if (!inputs) return null;
    const output = str(p.output, 200);
    const note = str(p.note);
    return {
      inputs,
      ...(output ? { output } : {}),
      ...(note ? { note } : {}),
    };
  }

  if (type === "report") {
    const note = str(p.note);
    const category = str(p.category, 80);
    const recipeId = str(p.recipeId, 80);
    const itemId = str(p.itemId, 80);
    const recipeInputs = strList(p.recipeInputs);
    // Require at least a note or a recipe reference so we don't store empty
    // "something is broken" submissions.
    if (!note && !recipeId && !itemId) return null;
    return {
      ...(category ? { category } : {}),
      ...(note ? { note } : {}),
      ...(recipeId ? { recipeId } : {}),
      ...(itemId ? { itemId } : {}),
      ...(recipeInputs ? { recipeInputs } : {}),
    };
  }

  // other
  const note = str(p.note);
  if (!note) return null;
  return { note };
}
