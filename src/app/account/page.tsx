import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getSession } from "@/lib/session";
import { AccountActions } from "./AccountActions";
import { HandlePicker } from "./HandlePicker";

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
    handle?: string | null;
    handleLockedAt?: string | Date | null;
  };
  const tier = user.tier ?? "free";
  const handle = user.handle ?? null;
  const handleLocked = Boolean(user.handleLockedAt);

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
            <dt style={{ color: "var(--muted)" }}>Plan</dt>
            <dd style={{ margin: 0 }}>
              {tier === "paid" ? "Family" : "Free"}
            </dd>
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
          <h3 style={{ marginTop: 0 }}>Manage</h3>
          <AccountActions />
        </section>
      </div>
      <Footer />
    </main>
  );
}
