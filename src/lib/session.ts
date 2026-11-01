import { headers } from "next/headers";
import { getAuth } from "./auth";

export async function getSession() {
  return getAuth().api.getSession({ headers: await headers() });
}

export async function requireUser() {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  return s.user;
}

/** True if the current session belongs to an admin. Falls back to false on
 *  anonymous or non-admin sessions — callers decide the response code. */
export async function isAdmin(): Promise<boolean> {
  const s = await getSession();
  return (s?.user as { role?: string } | undefined)?.role === "admin";
}
