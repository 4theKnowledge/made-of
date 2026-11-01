import { NextResponse } from "next/server";
import { getSession } from "./session";

/**
 * Guard for admin API route handlers. Returns a NextResponse on failure
 * (401 if not signed in, 403 if signed in without the admin role) so
 * callers can early-return. Returns `null` on success — the caller then
 * knows the session is valid.
 *
 * This mirrors the UI gate in /admin/layout.tsx; both are enforced because
 * CLAUDE.md requires server-side entitlement checks, not just UI hiding.
 */
export async function requireAdminApi(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = (session.user as { role?: string } | undefined)?.role;
  if (role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}
