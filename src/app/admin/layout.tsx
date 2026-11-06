import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession } from "@/lib/session";
import { AdminToastProvider } from "./_toast";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin · Made Of",
  robots: { index: false, follow: false },
};

/**
 * Admin gate. Non-admins get redirected before any admin content renders.
 * The matching API routes also check — this is the UI half of the pair,
 * not the only gate.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/admin");
  const role = (session.user as { role?: string }).role;
  if (role !== "admin") redirect("/");
  return <AdminToastProvider>{children}</AdminToastProvider>;
}
