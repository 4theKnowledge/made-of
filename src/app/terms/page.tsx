import type { Metadata } from "next";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Terms · Made Of",
  description:
    "The rules for using Made Of, including accounts, acceptable use and content.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <main className="wrap">
      <Header />

      <div className="pricing">
        <section className="phero">
          <span className="eyebrow">Terms of use</span>
          <h2>Short, plain and honest.</h2>
          <p>
            Made Of is free to explore. These terms cover how you can use the
            site, what accounts involve, and the limits on both of us.
          </p>
        </section>

        <section className="feat">
          <h3>Who it&rsquo;s for</h3>
          <ul className="dots">
            <li>
              <b>13 and over to use an account.</b> If you&rsquo;re in the EU,
              UK or another region with a higher age of digital consent (often
              16), that limit applies instead. If you&rsquo;re younger, you
              can still read the public pages with a parent, guardian or
              teacher.
            </li>
            <li>
              <b>Classrooms are welcome.</b> Teachers can use the free version
              in class today. The educator version with class spaces arrives
              later.
            </li>
          </ul>
        </section>

        <section className="feat">
          <h3>Accounts</h3>
          <ul className="dots">
            <li>
              <b>Sign-in is by email link.</b> We send a one-time link to your
              email. We don&rsquo;t store a password.
            </li>
            <li>
              <b>Keep your email access secure.</b> Anyone with access to your
              inbox can sign in as you. If you lose access, email us.
            </li>
            <li>
              <b>One account per person.</b> Don&rsquo;t share accounts or
              create accounts in someone else&rsquo;s name.
            </li>
            <li>
              <b>Delete any time.</b> You can delete your account from the
              account page. We&rsquo;ll remove your email, sessions and saved
              progress.
            </li>
          </ul>
        </section>

        <section className="feat">
          <h3>What you can do with the content</h3>
          <ul className="dots">
            <li>
              <b>Use it in lessons, posts and stories.</b> The map, the facts
              and the evidence are here to be shared. A link back is
              appreciated.
            </li>
            <li>
              <b>Don&rsquo;t scrape it.</b> Automated extraction of the whole
              map, bulk downloading via the API, and bypassing rate limits are
              not allowed. An open data export is planned.
            </li>
            <li>
              <b>Don&rsquo;t pass it off as yours.</b> If you republish
              substantial chunks, say where it came from.
            </li>
          </ul>
        </section>

        <section className="feat">
          <h3>Acceptable use</h3>
          <p>
            Don&rsquo;t use Made Of to harass others, break the law, or
            interfere with the service (probing for vulnerabilities, flooding
            endpoints, trying to bypass server-side checks). We may suspend
            accounts that do.
          </p>
        </section>

        <section className="feat">
          <h3>Evidence disclaimer</h3>
          <p>
            Every link carries evidence and a confidence level, so you can tell
            settled science from open questions. The research was done with the
            help of Claude, an AI model made by Anthropic, using real published
            sources. It has not yet been reviewed by experts, so it may contain
            mistakes. Made Of is provided <em>as is</em>, without warranty of
            accuracy or fitness for any particular use.
          </p>
        </section>

        <section className="feat">
          <h3>Changes and contact</h3>
          <p>
            We may update these terms as the site grows. Material changes will
            be surfaced on the site. The full legal terms &mdash; liability,
            dispute resolution and governing law &mdash; are being drafted and
            will land here before paid plans open.
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
