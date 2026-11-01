import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { getDb, schema } from "@/db/client";
import { isValidHandle, randomHandleCandidate } from "@/lib/handle-words";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lock the user's handle in. Rejects if a handle is already locked (immutable
// after confirm) or if the submitted value isn't a well-formed, available
// adjective-noun pair. The write is guarded with `handleLockedAt IS NULL` in
// the WHERE clause so a race between two tabs can only win once.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  let body: { handle?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = typeof body.handle === "string" ? body.handle.trim().toLowerCase() : "";
  if (!isValidHandle(raw)) {
    return NextResponse.json({ error: "Invalid handle" }, { status: 400 });
  }

  const db = getDb();

  // Attempt the update. Uses the lower(handle) unique index to catch
  // concurrent claims from a different user.
  try {
    const updated = await db
      .update(schema.authUser)
      .set({ handle: raw, handleLockedAt: new Date() })
      .where(
        and(
          eq(schema.authUser.id, session.user.id),
          isNull(schema.authUser.handleLockedAt),
        ),
      )
      .returning({ id: schema.authUser.id });

    if (updated.length === 0) {
      return NextResponse.json(
        { error: "Handle already locked" },
        { status: 409 },
      );
    }
  } catch (err) {
    // Unique violation code from Postgres.
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json({ error: "Handle already taken" }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true, handle: raw });
}

// Replace the user's unlocked suggestion with a fresh random one. No-op if
// the handle is already locked. The suggestion is written to the user row so
// the client can refresh and read it back from the session.
export async function PATCH() {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const db = getDb();

  // Guard against rerolling after lock.
  const [row] = await db
    .select({ lockedAt: schema.authUser.handleLockedAt })
    .from(schema.authUser)
    .where(eq(schema.authUser.id, session.user.id))
    .limit(1);
  if (!row) return new NextResponse("Not found", { status: 404 });
  if (row.lockedAt) {
    return NextResponse.json({ error: "Handle locked" }, { status: 409 });
  }

  // Try candidates until one survives the unique index. On conflict we loop;
  // on exhaustion we 503 so the caller can retry.
  for (let i = 0; i < 10; i++) {
    const candidate = randomHandleCandidate();
    try {
      const updated = await db
        .update(schema.authUser)
        .set({ handle: candidate })
        .where(
          and(
            eq(schema.authUser.id, session.user.id),
            isNull(schema.authUser.handleLockedAt),
            // Ensure the candidate isn't held by anyone else (including this
            // user — avoids no-op updates returning stale rows).
            sql`NOT EXISTS (
              SELECT 1 FROM "user" u2
              WHERE lower(u2."handle") = ${candidate}
                AND u2."id" <> ${session.user.id}
            )`,
          ),
        )
        .returning({ handle: schema.authUser.handle });
      if (updated[0]?.handle) {
        return NextResponse.json({ ok: true, handle: updated[0].handle });
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "23505") throw err;
    }
  }

  return NextResponse.json(
    { error: "Could not find an available handle" },
    { status: 503 },
  );
}
