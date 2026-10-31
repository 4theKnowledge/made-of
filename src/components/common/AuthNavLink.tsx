import Link from "next/link";
import { getSession } from "@/lib/session";

export async function AuthNavLink() {
  const session = await getSession();
  if (session) {
    return (
      <Link href="/account" title={session.user.email}>
        Account
      </Link>
    );
  }
  return <Link href="/sign-in">Sign in</Link>;
}
