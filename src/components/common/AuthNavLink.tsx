"use client";

import Link from "next/link";
import { useSession } from "@/lib/auth-client";

/**
 * Client-side auth link in the header. Rendered as a Link stub during SSR so
 * static pages can prerender, then hydrated with the real session on the
 * client. Avoids forcing every page that imports Header to be dynamic.
 */
export function AuthNavLink() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <Link href="/sign-in" aria-hidden="true" style={{ visibility: "hidden" }}>
        Sign in
      </Link>
    );
  }

  if (session) {
    const role = (session.user as { role?: string }).role;
    return (
      <>
        {role === "admin" && <Link href="/admin">Admin</Link>}
        <Link href="/account" title={session.user.email}>
          Account
        </Link>
      </>
    );
  }
  return <Link href="/sign-in">Sign in</Link>;
}
