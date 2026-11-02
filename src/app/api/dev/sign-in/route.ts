import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db/client";
import { devMagicLinks, getAuth, isDevAdminEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

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

  // Hit the real verify endpoint so Better Auth creates the session and
  // issues Set-Cookie. We don't want its 302 redirect — just the cookies.
  const verifyRes = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      // Better Auth's originCheck inspects these. Forward them from the
      // incoming request so the check passes against our own origin.
      origin: req.headers.get("origin") ?? "",
      referer: req.headers.get("referer") ?? "",
      cookie: req.headers.get("cookie") ?? "",
    },
  });

  // The user-create hook promotes new dev-admin users at sign-up. For
  // pre-existing users (role already defaulted to "user"), promote here.
  if (isDevAdminEmail(email)) {
    const db = getDb();
    await db
      .update(schema.authUser)
      .set({ role: "admin" })
      .where(eq(schema.authUser.email, email));
  }

  const res = NextResponse.json({ ok: true });
  const setCookies = verifyRes.headers.getSetCookie();
  for (const c of setCookies) res.headers.append("set-cookie", c);
  return res;
}
