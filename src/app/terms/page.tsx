import type { Metadata } from "next";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Terms · Made Of",
  description:
    "The rules for using Made Of. Full terms arrive at launch, alongside accounts.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <main className="wrap">
      <Header />

      <div className="pricing">
        <section className="phero">
          <span className="eyebrow">Terms of use</span>
          <h2>Short version, with the long one coming at launch.</h2>
          <p>
            Made Of is free to explore. We&rsquo;re publishing the full terms
            when accounts open. These are the parts that matter today.
          </p>
        </section>

        <section className="feat">
          <h3>Who it&rsquo;s for</h3>
          <ul className="dots">
            <li>
              <b>13 and over.</b> If you&rsquo;re younger, use Made Of with a
              parent, guardian or teacher. The family version will add child
              profiles supervised by a parent.
            </li>
            <li>
              <b>Classrooms are welcome.</b> Teachers can use the free version
              in class today, and the educator version adds class spaces and
              lesson plans at launch.
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
              not allowed. We publish an open data export at launch for folks
              who want the whole thing.
            </li>
            <li>
              <b>Don&rsquo;t pass it off as yours.</b> If you republish
              substantial chunks, say where it came from.
            </li>
          </ul>
        </section>

        <section className="feat">
          <h3>Evidence disclaimer</h3>
          <p>
            Every link carries evidence and a confidence level, so you can tell
            settled science from open questions. The research was done with the
            help of Claude, an AI model made by Anthropic, using real published
            sources. It has not yet been reviewed by experts, so it may contain
            mistakes. We&rsquo;ll add a way to report issues before launch.
          </p>
        </section>

        <section className="feat">
          <h3>The full terms</h3>
          <p>
            The complete terms, including liability, warranties, dispute
            resolution and the jurisdiction they&rsquo;re governed by, will
            land here before accounts open.
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
