import type { Metadata } from "next";
import Link from "next/link";
import { getLiveSnapshot } from "@/graph/live";
import { Header } from "@/components/common/Header";
import { getDb, schema } from "@/db/client";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Pricing · Made Of",
  description:
    "Made Of is free for everyone. Family and Educator plans add tools for home and classroom learning.",
  alternates: { canonical: "/pricing" },
};

export default async function PricingPage() {
  // Live counts drive the "N things, N evidenced links" copy in the Free card.
  const live = await getLiveSnapshot();
  const db = getDb();
  const [{ count: evCount } = { count: 0 }] = await db
    .selectDistinct({ count: schema.linkEvidence.linkId })
    .from(schema.linkEvidence)
    .then((rows) => [{ count: rows.length }]);

  const itemCount = live.snapshot.nodes.size;

  return (
    <main className="wrap">
      <Header current="pricing" />

      <div className="pricing">
        <section className="phero">
          <span className="eyebrow">Pricing</span>
          <h2>Free for everyone. Extra tools for families and classrooms.</h2>
          <p>
            Everything in Made Of stays free for anyone, with no account and
            no ads. The family and educator versions add ways to pitch it at
            the right level and to follow a learner&rsquo;s progress, at home
            or in class.
          </p>
        </section>

        <section className="plans" aria-label="Plans">
          <article className="plan">
            <div className="plan-top">
              <h3>Free</h3>
              <span className="who">For anyone curious</span>
            </div>
            <div className="price">
              <b>$0</b>
              <span>always</span>
            </div>
            <ul className="ticks">
              <li>
                {itemCount} things and how they connect, from the big bang to
                the internet
              </li>
              <li>Daily link puzzle, with a shareable result</li>
              <li>From scratch, the timed building game</li>
              <li>Evidence and sources on {evCount} links</li>
              <li>No account, no ads</li>
            </ul>
            <Link className="btn primary" href="/explore/water">
              Start exploring
            </Link>
          </article>

          <article className="plan">
            <div className="plan-top">
              <h3>Family</h3>
              <span className="who">For kids learning at home</span>
            </div>
            <div className="price">
              <b className="tbd">Pricing to come</b>
              <span>per family</span>
            </div>
            <ul className="ticks">
              <li>Everything in Free</li>
              <li>A profile for each child, with their own progress</li>
              <li>The junior interface and difficulty levels</li>
              <li>Self-paced trails, with badges to collect</li>
              <li>
                A saved map of everything they&rsquo;ve explored, and goals to
                aim for
              </li>
              <li>A weekly summary for parents</li>
            </ul>
            <span className="soon">In development · sign-ups open at launch</span>
          </article>

          <article className="plan edu">
            <div className="plan-top">
              <h3>Educator</h3>
              <span className="who">For teachers, classes and schools</span>
            </div>
            <div className="price">
              <b className="tbd">Pricing to come</b>
              <span>per class or school</span>
            </div>
            <ul className="ticks">
              <li>Everything in Free</li>
              <li>Three difficulty levels, from short chains to full depth</li>
              <li>A junior interface for younger students</li>
              <li>Ready-made lesson plans and guided trails</li>
              <li>
                A class space to play together, plus a teacher dashboard
              </li>
              <li>Saved exploration and class or personal goals</li>
            </ul>
            <span className="soon">In development · sign-ups open at launch</span>
          </article>
        </section>

        <section className="feat">
          <h3>What&rsquo;s coming next</h3>
          <p>
            Sign-ups for Family and Educator open at launch. The free version
            will stay free, forever, with every item, link and source available
            to anyone.
          </p>
        </section>
      </div>
    </main>
  );
}
