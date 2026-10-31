import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Privacy · Made Of",
  description:
    "How Made Of handles data: accounts, email, analytics, and the services we use.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="wrap">
      <Header />

      <div className="pricing">
        <section className="phero">
          <span className="eyebrow">Privacy</span>
          <h2>What we collect, and what we don&rsquo;t.</h2>
          <p>
            You can use most of Made Of without an account. If you sign in,
            we keep only what&rsquo;s needed to run the site. No ads, no
            tracking across other sites, no selling data.
          </p>
        </section>

        <section className="feat">
          <h3>What we aim for</h3>
          <ul className="dots">
            <li>
              <b>No child data.</b> Accounts are 13+ (16+ in the EU and UK).
              We don&rsquo;t enable session replay, and we never set
              identifying properties for anyone who might be a child.
            </li>
            <li>
              <b>Minimum necessary.</b> We only collect what&rsquo;s needed to
              run the site.
            </li>
            <li>
              <b>No ads, no retargeting.</b> Made Of is free because of family
              and educator plans and sponsors, not advertising.
            </li>
            <li>
              <b>Analytics without identity.</b> If we identify you to
              analytics at all, it&rsquo;s by an opaque user id &mdash; never
              email or name.
            </li>
          </ul>
        </section>

        <section className="feat">
          <h3>What we store when you have an account</h3>
          <ul className="dots">
            <li>
              <b>Email address,</b> so we can send you sign-in links.
            </li>
            <li>
              <b>Sign-in sessions,</b> which are rotating tokens stored in a
              cookie and in our database. We also keep the IP address and
              browser user-agent for the session, to help you spot
              unauthorised sign-ins.
            </li>
            <li>
              <b>Your plan</b> (free or paid), and &mdash; when paid plans
              open &mdash; a Stripe customer id so billing works.
            </li>
            <li>
              <b>Your saved progress:</b> daily streaks, pinned items and
              crafting state. Tied to your account id, not your email.
            </li>
          </ul>
        </section>

        <section className="feat">
          <h3>Services we rely on</h3>
          <ul className="dots">
            <li>
              <b>Railway</b> hosts the app and database (US region).
            </li>
            <li>
              <b>Cloudflare</b> sits in front for caching and bot protection.
            </li>
            <li>
              <b>Resend</b> sends your sign-in email. They see your email
              address and the message, and keep delivery logs.
            </li>
            <li>
              <b>Stripe</b> will handle payments when paid plans open. We
              never see your card details.
            </li>
            <li>
              <b>PostHog</b> handles product analytics. We identify you to
              PostHog by your Made Of user id only, never your email.
            </li>
          </ul>
        </section>

        <section className="feat">
          <h3>Deleting your account</h3>
          <p>
            Go to <Link href="/account">your account page</Link> and press
            &ldquo;Delete account&rdquo;. We remove your email, your sessions,
            your saved progress and (when billing is live) your Stripe link.
            Deletion is immediate.
          </p>
          <p>
            Anonymous counts (for example, how many people solved today&rsquo;s
            puzzle) are kept, because they can&rsquo;t be tied back to you.
          </p>
        </section>

        <section className="feat">
          <h3>Your rights</h3>
          <p>
            You can ask us what we hold about you, correct it, or delete it
            &mdash; the account page covers the common case. For anything else
            (including GDPR/UK data requests), email us and we&rsquo;ll reply
            within 30 days.
          </p>
          <p className="small" style={{ color: "var(--muted)" }}>
            Last updated: 2026-11-01.
          </p>
        </section>
      </div>

      <Footer />
    </main>
  );
}
