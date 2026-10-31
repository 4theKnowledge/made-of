import type { Metadata } from "next";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Privacy · Made Of",
  description:
    "How Made Of handles data. The full policy arrives at launch, alongside accounts.",
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
            Right now Made Of has no accounts, no ads and no third-party
            trackers. The full privacy policy arrives at launch, when accounts
            open and the family and educator plans are available.
          </p>
        </section>

        <section className="feat">
          <h3>What we aim for</h3>
          <ul className="dots">
            <li>
              <b>No child data.</b> No child profiles until a parent sets one
              up, and even then we never record session replays or sell data.
            </li>
            <li>
              <b>Minimum necessary.</b> We only collect what&rsquo;s needed to
              run the site: your email if you make an account, your streak and
              puzzle progress if you&rsquo;re signed in, nothing more.
            </li>
            <li>
              <b>No ads, no retargeting.</b> Made Of is free because of
              family and educator plans and sponsors, not advertising.
            </li>
            <li>
              <b>Analytics without identity.</b> We measure how the site is
              used, but we never link visits to names or email addresses, and
              never to anyone under 13.
            </li>
          </ul>
        </section>

        <section className="feat">
          <h3>The full policy</h3>
          <p>
            The complete policy, including the specific services we rely on
            (hosting, email delivery, payments, analytics), their data
            residency, retention windows and how to request deletion, will be
            published here before accounts open.
          </p>
          <p className="small" style={{ color: "var(--muted)" }}>
            Last updated: coming at launch.
          </p>
        </section>
      </div>

      <Footer />
    </main>
  );
}
