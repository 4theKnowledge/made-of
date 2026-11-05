import type { Metadata } from "next";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Method · Made Of",
  description:
    "How Made Of researches links, grades confidence and chooses what to simplify.",
  alternates: { canonical: "/method" },
};

export default function MethodPage() {
  return (
    <main className="wrap">
      <Header />

      <div className="pricing">
        <section className="phero">
          <span className="eyebrow">Method</span>
          <h2>How we build the map, and how we know.</h2>
          <p>
            Every link on Made Of carries evidence, a confidence level and
            sources. This page explains how we research, grade and simplify
            what the map says.
          </p>
        </section>

        <section className="feat">
          <h3>How a link gets on the map</h3>
          <ul className="dots">
            <li>
              <b>Research.</b> Each candidate link starts from real published
              sources. The current pass was researched with the help of Claude,
              an AI model made by Anthropic, which pulls from and cites real
              material.
            </li>
            <li>
              <b>Evidence summary.</b> Each link gets a short summary of what
              supports it and, where relevant, what argues against it.
            </li>
            <li>
              <b>Confidence level.</b> Every link is tagged <i>established</i>,{" "}
              <i>strong</i>, <i>debated</i> or <i>hypothesis</i> so you can
              tell settled science from open questions.
            </li>
            <li>
              <b>Review.</b> The current evidence has not yet been reviewed by
              subject experts. We&rsquo;re opening a report-a-mistake flow
              before launch.
            </li>
          </ul>
        </section>

        <section className="feat">
          <h3>Confidence levels</h3>
          <ul className="dots">
            <li>
              <b>Established.</b> Textbook consensus. Very unlikely to change.
            </li>
            <li>
              <b>Strong.</b> Well supported, though details are still argued.
            </li>
            <li>
              <b>Debated.</b> Serious competing explanations exist. We show
              each idea side by side.
            </li>
            <li>
              <b>Hypothesis.</b> Plausible, but the evidence is thin. Treated
              as such on the map and in the games.
            </li>
          </ul>
        </section>

        <section className="feat">
          <h3>What we simplify</h3>
          <p>
            Any map leaves things out. The biggest simplifications are the
            same ones on the <i>About</i> page: a small cast of items standing
            in for many; the tree of life as a single line; materials
            generalised (&ldquo;steel&rdquo; for hundreds of grades); dates as
            first appearances, often approximate.
          </p>
        </section>

        <section className="feat">
          <h3>Sources</h3>
          <p>
            Each link&rsquo;s evidence drawer lists its sources with titles,
            authors, year and a link where one exists. Full source metadata
            lives in the database and will be exposed through a public API and
            an open data export before launch.
          </p>
        </section>

        <section className="feat">
          <h3>Spotted a mistake?</h3>
          <p>
            A report-a-mistake flow is coming before launch, along with contact
            details for teachers, parents and sponsors. Until then, hold on to
            notes — we&rsquo;ll ask for them.
          </p>
        </section>
      </div>

      <Footer />
    </main>
  );
}
