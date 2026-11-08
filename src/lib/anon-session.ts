/**
 * Anonymous session for server-authoritative Combine runs (T-0175).
 *
 * Combine allows guest play (no sign-in). To tie mid-run state to a
 * stable identity we hand out a UUID in a cookie, HMAC-signed with the
 * server's `COMBINE_SIGNING_SECRET`, so the client can't forge or mutate
 * it. On sign-in a merge hook rewrites `combine_runs.owner_kind='user'`
 * for the then-signed-in user (see `src/lib/auth.ts`).
 *
 * The cookie value is `<uuid>.<base64url-hmac>`. Anything else — missing
 * cookie, wrong signature, malformed — is treated as "no anon id yet"
 * and a fresh one is minted.
 *
 * Importantly, this module does NOT run on module load. Reading/minting
 * happens on each request via `getAnonId()` so it works with Next's
 * per-request header stores.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getSession } from "./session";

const COOKIE_NAME = "madeof_anon";
// One year — the anon id is long-lived by design (it's how guests resume
// across sessions). The HMAC lets us rotate secrets without invalidating
// every cookie at once if we ever need to (ship a rotation path that
// accepts both the old and new secret for a window).
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;

/** The signing secret. Required at runtime; the app refuses to issue
 *  anon cookies without one so we never fall back to an unsigned id.
 *  Set this in production env; dev uses a well-known default via
 *  `.env.local`. */
function signingSecret(): string {
  const s = process.env.COMBINE_SIGNING_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "COMBINE_SIGNING_SECRET must be set to a 16+ char value before anon sessions can be issued",
    );
  }
  return s;
}

function sign(id: string): string {
  const mac = createHmac("sha256", signingSecret()).update(id).digest();
  return mac.toString("base64url");
}

function verify(id: string, mac: string): boolean {
  try {
    const expected = Buffer.from(sign(id), "base64url");
    const given = Buffer.from(mac, "base64url");
    if (expected.length !== given.length) return false;
    return timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}

/** Parse a cookie value shaped `<uuid>.<base64url-hmac>`. Returns the
 *  uuid if the signature checks out, else null. */
function parse(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const id = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  // Loose UUID shape check — the signature is the real guard, this just
  // keeps garbage out of logs if someone edits the cookie by hand.
  if (!/^[0-9a-f-]{32,36}$/i.test(id)) return null;
  if (!verify(id, mac)) return null;
  return id;
}

/** Read the current request's anon id, or null if none is set. Does
 *  NOT mint a new one — use `getOrMintAnonId()` when you need identity
 *  for a write. Separated so read-only routes don't produce Set-Cookie
 *  headers unnecessarily. */
export async function readAnonId(): Promise<string | null> {
  const jar = await cookies();
  return parse(jar.get(COOKIE_NAME)?.value);
}

/** Read the anon id, minting + setting the cookie if absent or invalid.
 *  Returns the stable id. Must be called from a route that can set
 *  response cookies (any Next Route Handler or Server Action). */
export async function getOrMintAnonId(): Promise<string> {
  const jar = await cookies();
  const existing = parse(jar.get(COOKIE_NAME)?.value);
  if (existing) return existing;
  const id = randomUUID();
  const value = `${id}.${sign(id)}`;
  jar.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_SEC,
    path: "/",
  });
  return id;
}

export type RunOwner =
  | { kind: "user"; id: string }
  | { kind: "anon"; id: string };

/** Identify the current request's "run owner" — a Better Auth user id
 *  when signed in, else the signed anon id. For reads (no write), pass
 *  `{ mint: false }` to avoid setting a cookie on every GET. */
export async function getRunOwner(
  opts: { mint?: boolean } = {},
): Promise<RunOwner | null> {
  const session = await getSession();
  const userId = session?.user?.id;
  if (userId) return { kind: "user", id: userId };
  const anonId = opts.mint === false ? await readAnonId() : await getOrMintAnonId();
  if (!anonId) return null;
  return { kind: "anon", id: anonId };
}
