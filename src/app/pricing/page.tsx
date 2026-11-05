import type { Metadata } from "next";
import Link from "next/link";
import { getLiveSnapshot } from "@/graph/live";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Pricing · Made Of",
  description:
    "Every game on Made Of is free. Become a Patron for early access, extra collections and deeper stats across every game. Sponsors help keep the map free.",
  alternates: { canonical: "/pricing" },
};

export default async function PricingPage() {
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
          <h2>Play free. Become a Patron.</h2>
          <p>
            Every game on Made Of is free, with no account needed and no
            ads. Combine is the one to play today — endless, fast and the
            daily puzzle, all sharing a lifetime collection. Patrons back
            the project and get early access to new items, extra Combine
            collections to unlock, and deeper stats across every game.
            Museums and foundations can sponsor sections of the map.
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
                <b>Combine</b> — endless, fast and the daily puzzle, all
                with a shareable result
              </li>
              <li>
                A lifetime collection of everything you&rsquo;ve
                discovered, carried across runs
              </li>
              <li>
                Explore the full map of {itemCount} things, from the big
                bang to the internet
              </li>
              <li>
                Full upstream trace for any item — every path back to the
                big bang, in one view
              </li>
              <li>Evidence and sources on {evCount} links</li>
              <li>No account needed, no ads</li>
            </ul>
            <Link className="btn primary" href="/combine">
              Play Combine
            </Link>
          </article>

          <article className="plan">
            <div className="plan-top">
              <h3>Patron</h3>
              <span className="who">Back the project, get more</span>
            </div>
            <div className="price">
              <b className="tbd">Pricing to come</b>
              <span>monthly or yearly</span>
            </div>
            <ul className="ticks">
              <li>Everything in Free</li>
              <li>
                <b>Early access to new items and evidence</b> as they
                land in the knowledge base — see additions a week before
                everyone else
              </li>
              <li>
                <b>Extra Combine collections</b> to unlock — patron-only
                themes and harder challenge sets
              </li>
              <li>
                <b>Deeper stats across every game</b> — run history,
                personal bests, named runs you can come back to
              </li>
              <li>
                Early access to new games as they land
              </li>
              <li>
                Patron badge on leaderboards and shared results
              </li>
              <li>
                Keeps the map, the games and the research free for
                everyone else
              </li>
            </ul>
            <span className="soon">In development · sign-ups open at launch</span>
          </article>

          <article className="plan">
            <div className="plan-top">
              <h3>Sponsor</h3>
              <span className="who">For museums and foundations</span>
            </div>
            <div className="price">
              <b className="tbd">By arrangement</b>
              <span>per trail or section</span>
            </div>
            <ul className="ticks">
              <li>
                A &ldquo;made possible by&rdquo; credit on a trail or a
                section of the map
              </li>
              <li>A listing on the supporters page</li>
              <li>
                Optional: a sponsored Combine daily puzzle on your subject
              </li>
              <li>
                No say over items, facts or evidence — our evidence rules
                apply everywhere
              </li>
            </ul>
            <Link className="btn primary" href="#sponsorSec">
              See how it works
            </Link>
          </article>
        </section>

        <section className="feat-head" id="sponsorSec">
          <h2>Sponsor a trail or section</h2>
          <p>
            Museums, science centres, societies and foundations can help
            keep Made Of free by sponsoring part of the map. Sponsors get a
            clear credit where it&rsquo;s relevant. They never get a say in
            what the map says.
          </p>
        </section>

        <section className="feat wide">
          <div className="ftext">
            <h3>What sponsors get</h3>
            <ul className="dots">
              <li>
                A &ldquo;made possible by&rdquo; credit on a trail or a
                section of the map, like the tree of life or the story of
                the microchip.
              </li>
              <li>A listing on the supporters page.</li>
              <li>
                Optional: a sponsored Combine daily puzzle, themed on
                your subject.
              </li>
            </ul>
            <h3 style={{ marginTop: "6px" }}>What sponsors don&rsquo;t get</h3>
            <ul className="dots">
              <li>
                Any influence over items, facts, links or evidence. Our
                evidence rules apply to every section, sponsored or not.
              </li>
              <li>Ads, tracking or data about people playing.</li>
              <li>
                Sections where they have a stake. An oil company
                can&rsquo;t sponsor the oil chain, and a chipmaker
                can&rsquo;t sponsor the microchip.
              </li>
            </ul>
            <p
              className="small"
              style={{
                color: "var(--muted)",
                fontSize: "13.5px",
                marginTop: "4px",
              }}
            >
              Sponsorship opens once Made Of has its own home on the web.
              Contact details will be here.
            </p>
          </div>
        </section>

        <section className="faq">
          <h2>Questions</h2>
          <details>
            <summary>Will the games stay free?</summary>
            <p>
              Yes. Combine, the Explore map and every future game stay
              free to play for everyone, no account needed.
            </p>
          </details>
          <details>
            <summary>What does a Patron get?</summary>
            <p>
              Early access to new items and evidence as they&rsquo;re
              added to the knowledge base, extra Combine collections to
              unlock, and deeper stats across every game (run history,
              personal bests, named runs). Plus early access to new games
              as they land, and a Patron badge on leaderboards. The exact
              list and price will land before Patron sign-ups open.
            </p>
          </details>
          <details>
            <summary>
              Are there more games in the works?
            </summary>
            <p>
              Yes. Combine is the one to play today, with more games
              planned on top of the same knowledge base. Patrons get
              early access as each one lands.
            </p>
          </details>
          <details>
            <summary>Is Made Of independent?</summary>
            <p>
              Yes. Sponsors and paying customers never decide what goes on
              the map. Every link follows the same evidence rules, and
              debated things stay marked as debated.
            </p>
          </details>
          <details>
            <summary>
              What about parents, teachers or classrooms?
            </summary>
            <p>
              Combine and Explore work in any classroom or at home today.
              Dedicated tools for families and schools are being thought
              through separately — expect more here later.
            </p>
          </details>
        </section>
      </div>

      <Footer />
    </main>
  );
}
