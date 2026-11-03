import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { invitesRequired } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { SignInForm } from "./SignInForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in · Made Of",
  description: "Sign in to Made Of to save your progress.",
  alternates: { canonical: "/sign-in" },
  robots: { index: false },
};

export default async function SignInPage() {
  const session = await getSession();
  if (session) redirect("/account");

  const stealth = process.env.STEALTH_MODE === "1";

  return (
    <main className="wrap">
      <Header />
      <div className="pricing">
        <section className="phero">
          <span className="eyebrow">{stealth ? "Private beta" : "Sign in"}</span>
          <h2>
            {stealth
              ? "Made Of is in private beta."
              : "No password. Just an email."}
          </h2>
          <p>
            {stealth
              ? "Sign in with your invited email to continue. We'll send a one-time link — no password."
              : "Enter your email and we'll send you a link to sign in. Signing in lets you save your streak, pinned items and crafting progress across devices."}
          </p>
        </section>
        <section className="feat">
          <SignInForm inviteRequired={invitesRequired()} />
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 16 }}>
            By continuing you confirm you are 13 or older and agree to our{" "}
            <Link href="/terms">Terms</Link> and{" "}
            <Link href="/privacy">Privacy</Link>.
          </p>
        </section>
      </div>
      <Footer />
    </main>
  );
}
