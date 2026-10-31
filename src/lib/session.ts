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
