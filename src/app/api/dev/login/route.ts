import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db/client";
import { devMagicLinks, getAuth, isDevAdminEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Agent-oriented dev login. Four independent gates; any failure returns 404
// to avoid signalling the route exists:
//   1. NODE_ENV !== "production"
//   2. DEV_LOGIN_KEY env set (inert-by-default if accidentally deployed)
//   3. x-origin-lock header absent (prod CF requests always carry it)
//   4. Authorization: Bearer <DEV_LOGIN_KEY>, compared via timingSafeEqual
//
// Separate from /api/dev/sign-in (used by the browser "Dev sign in" button)
// so parallel agents can each mint their own session without sharing a
// storage-state file and without breaking the UI button's keyless flow.

function notFound() {
  return new NextResponse("Not found", { status: 404 });
}

function constantTimeEqualsString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return notFound();

  const expectedKey = process.env.DEV_LOGIN_KEY;
  if (!expectedKey) return notFound();

  if (req.headers.get("x-origin-lock")) return notFound();

  const authz = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(authz);
  if (!match) return notFound();
  if (!constantTimeEqualsString(match[1], expectedKey)) return notFound();

  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const auth = getAuth();
  await auth.api.signInMagicLink({
    body: { email, callbackURL: "/account" },
    headers: req.headers,
  });

  const url = devMagicLinks.get(email);
  devMagicLinks.delete(email);
  if (!url) {
    return NextResponse.json(
      { error: "magic link was not captured — is NODE_ENV=production?" },
      { status: 500 },
    );
  }

  const verifyRes = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      origin: req.headers.get("origin") ?? "",
      referer: req.headers.get("referer") ?? "",
      cookie: req.headers.get("cookie") ?? "",
    },
  });

  if (isDevAdminEmail(email)) {
    const db = getDb();
    await db
      .update(schema.authUser)
      .set({ role: "admin" })
      .where(eq(schema.authUser.email, email));
  }

  const setCookies = verifyRes.headers.getSetCookie();
  const res = NextResponse.json({ ok: true, cookies: setCookies });
  for (const c of setCookies) res.headers.append("set-cookie", c);
  return res;
}
