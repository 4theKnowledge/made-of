import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getSession } from "@/lib/session";
import { loadAccountStats } from "@/lib/stats/load";
import { AccountActions } from "./AccountActions";
import { EmailVerification } from "./EmailVerification";
import { HandlePicker } from "./HandlePicker";
import { StatsPanel } from "./StatsPanel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account · Made Of",
  description: "Your Made Of account.",
  alternates: { canonical: "/account" },
  robots: { index: false },
};

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const user = session.user as typeof session.user & {
    tier?: string;
    role?: string;
    handle?: string | null;
    handleLockedAt?: string | Date | null;
    emailVerified?: boolean;
  };
  const tier = user.tier ?? "free";
  const isAdmin = user.role === "admin";
  const handle = user.handle ?? null;
  const handleLocked = Boolean(user.handleLockedAt);
  const emailVerified = Boolean(user.emailVerified);
  const stats = await loadAccountStats(session.user.id);

  return (
    <main className="wrap">
      <Header />
      <div className="pricing">
        <section className="phero">
          <span className="eyebrow">Account</span>
          <h2>Your account</h2>
        </section>
        <section className="feat">
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: 0 }}>
            <dt style={{ color: "var(--muted)" }}>Email</dt>
            <dd style={{ margin: 0 }}>{user.email}</dd>
            <dt style={{ color: "var(--muted)" }}>Verification</dt>
            <dd style={{ margin: 0 }}>
              <EmailVerification email={user.email} verified={emailVerified} />
            </dd>
            <dt style={{ color: "var(--muted)" }}>Plan</dt>
            <dd style={{ margin: 0 }}>
              {tier === "paid" ? "Family" : "Free"}
            </dd>
            {isAdmin && (
              <>
                <dt style={{ color: "var(--muted)" }}>Role</dt>
                <dd style={{ margin: 0 }}>
                  Admin · <Link href="/admin">Open admin</Link>
                </dd>
              </>
            )}
            <dt style={{ color: "var(--muted)" }}>Member since</dt>
            <dd style={{ margin: 0 }}>
              {new Date(user.createdAt).toLocaleDateString()}
            </dd>
          </dl>
        </section>
        <section className="feat">
          <h3 style={{ marginTop: 0 }}>Display name</h3>
          <HandlePicker initialHandle={handle} locked={handleLocked} />
        </section>
        <section className="feat">
          <h3 style={{ marginTop: 0 }}>Your stats</h3>
          <StatsPanel stats={stats} />
        </section>
        <section className="feat">
          <h3 style={{ marginTop: 0 }}>Manage</h3>
          <AccountActions />
        </section>
      </div>
      <Footer />
    </main>
  );
}
