import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db/client";
import {
  getAuth,
  invitesRequired,
  stashPendingInvite,
} from "@/lib/auth";
import { checkInvite, normalizeCode } from "@/lib/invites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Soft-launch sign-in gate. New emails must present a valid invite code
 * when INVITES_REQUIRED=1. Returning users (anyone already in `authUser`)
 * bypass the check so a rotation of codes doesn't lock them out.
 *
 * On success we stash (email → code) in memory and ask Better Auth to
 * send the magic link. The code is actually redeemed in the user-create
 * hook after the user clicks the link, so a magic link that's never used
 * doesn't burn a seat.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    invite?: string;
    callbackURL?: string;
  };
  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  const callbackURL = body.callbackURL ?? "/account";

  const db = getDb();
  const [existing] = await db
    .select({ id: schema.authUser.id })
    .from(schema.authUser)
    .where(eq(schema.authUser.email, email))
    .limit(1);
  const isNewUser = !existing;

  if (isNewUser && invitesRequired()) {
    const invite = body.invite ? normalizeCode(body.invite) : "";
    if (!invite) {
      return NextResponse.json(
        { error: "An invite code is required to sign up." },
        { status: 400 },
      );
    }
    const check = await checkInvite(invite, "invite");
    if (!check.ok) {
      const msg =
        check.reason === "expired"
          ? "That invite code has expired."
          : check.reason === "spent"
            ? "That invite code has already been used."
            : "That invite code isn't valid.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    stashPendingInvite(email, invite);
  }

  const auth = getAuth();
  try {
    await auth.api.signInMagicLink({
      body: { email, callbackURL },
      headers: req.headers,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not send sign-in link.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
