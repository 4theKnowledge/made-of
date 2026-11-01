import type { Metadata } from "next";
import Link from "next/link";
import { getLiveSnapshot } from "@/graph/live";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { Chip } from "@/components/Chip";
import { getDb, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { TIER, TIER_ORDER, cap } from "@/lib/taxonomy";
import { REL, RORDER } from "@/lib/rel";
import type { LinkType, Confidence, Tier } from "@/db/schema";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "About · Made Of",
  description:
    "A shirt needs thread, thread needs cotton, cotton needs a plant, and the plant needs sunlight from a star. Made Of maps those connections.",
  alternates: { canonical: "/about" },
};

/** One short example per link type, from the prototype (line 2580). */
const REL_EXAMPLE: Record<LinkType, string> = {
  e: "Birds evolved from dinosaurs.",
  f: "Wool is made from sheep.",
  w: "Fabric is made with a loom.",
  n: "A tree needs sunlight.",
  s: "Coal comes from a mine.",
};

/** Example chips per tier, from the prototype (line 2582). Prefer these if
 * present on the live map; fall back to the first few items of that tier. */
const TIER_EXAMPLES: Record<Tier, string[]> = {
  F: ["hydrogen", "star", "gold"],
  N: ["sheep", "quartz", "tree"],
  M: ["steel", "wool", "glass"],
  C: ["microchip", "tyre", "screw"],
  P: ["pencil", "bread", "smartphone"],
  S: ["farm", "factory", "internet"],
};

const CONF_META: Record<Confidence, { label: string; cssVar: string }> = {
  established: { label: "Established", cssVar: "--good" },
  strong: { label: "Strong", cssVar: "--tC" },
  debated: { label: "Debated", cssVar: "--warn" },
  hypothesis: { label: "Hypothesis", cssVar: "--bad" },
};
const CONF_ORDER: Confidence[] = [
  "established",
  "strong",
  "debated",
  "hypothesis",
];

export default async function AboutPage() {
  const live = await getLiveSnapshot();
  const db = getDb();

  // Count links by type (prototype: relN).
  const relCount: Record<LinkType, number> = { f: 0, w: 0, n: 0, s: 0, e: 0 };
  let totalLinks = 0;
  for (const node of live.snapshot.nodes.values()) {
    for (const edge of node.up) {
      relCount[edge.type] += 1;
      totalLinks += 1;
    }
  }

  // Evidence breakdown: distinct links that have evidence, grouped by the
  // link's stored confidence (prototype: evIndex + byC).
  const evidencedLinks = await db
    .selectDistinct({
      linkId: schema.linkEvidence.linkId,
      confidence: schema.links.confidence,
    })
    .from(schema.linkEvidence)
    .innerJoin(
      schema.links,
      eq(schema.linkEvidence.linkId, schema.links.id),
    );

  const byConf: Record<Confidence, number> = {
    established: 0,
    strong: 0,
    debated: 0,
    hypothesis: 0,
  };
  for (const row of evidencedLinks) {
    byConf[row.confidence] = (byConf[row.confidence] ?? 0) + 1;
  }
  const evidencedLinkCount = evidencedLinks.length;

  const sourcesRows = await db
    .select({ id: schema.sources.id })
    .from(schema.sources);
  const sourceCount = sourcesRows.length;

  const confMax = Math.max(1, ...Object.values(byConf));
  const itemCount = live.snapshot.nodes.size;

  // Build tier example chip lists.
  const tiersExamples = TIER_ORDER.map((t) => {
    const wanted = TIER_EXAMPLES[t]
      .map((slug) => live.snapshot.bySlug.get(slug))
      .filter((n): n is NonNullable<typeof n> => Boolean(n));
    const inTier = [...live.snapshot.nodes.values()].filter(
      (n) => n.tier === t,
    );
    return { tier: t, examples: wanted, total: inTier.length };
  });

  return (
    <main className="wrap">
      <Header current="about" />

      <div className="pricing">
        <section className="phero">
          <span className="eyebrow">About</span>
          <h2>Everything comes from somewhere.</h2>
          <p>
            A shirt needs thread, thread needs cotton, cotton needs a plant,
            and the plant needs sunlight from a star. Made Of maps those
            connections for <b>{itemCount}</b> things, from the big bang to
            the internet, so you can follow any of them back to where it came
            from.
          </p>
        </section>

        <section className="feat wide">
          <div className="ftext">
            <h3>How the map works</h3>
            <p>
              Every item sits on a scale from raw to refined, and every link
              says what kind of connection it is. Most things can be made more
              than one way, so items can have several recipes.
            </p>
            <ul className="dots">
              {RORDER.map((k) => (
                <li key={k}>
                  <b>{REL[k].up}:</b> {REL_EXAMPLE[k]}{" "}
                  <span style={{ color: "var(--muted)" }}>
                    {relCount[k] || 0} links.
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="fvis">
            <div className="vis-cap">From raw to refined</div>
            <div className="atiers">
              {tiersExamples.map(({ tier, examples, total }) => (
                <div
                  key={tier}
                  className="atier"
                  style={
                    { "--c": `var(${TIER[tier].var})` } as React.CSSProperties
                  }
                >
                  <span className="tn">{TIER[tier].name}</span>
                  <span className="ex">
                    {examples.map((n) => (
                      <Chip
                        key={n.id}
                        slug={n.slug}
                        name={cap(n.name)}
                        tier={n.tier}
                        kind={n.kind}
                        symbol={n.symbol}
                        size="sm"
                        as="span"
                      />
                    ))}
                  </span>
                  <span className="n">{total}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="fgrid">
          <article className="feat">
            <h3>Explore</h3>
            <p>
              Pick anything and see what it takes and what it leads to. Follow
              a thread as far as you like.
            </p>
            <Link
              className="btn"
              href="/explore/water"
              style={{ alignSelf: "flex-start" }}
            >
              Start exploring
            </Link>
          </article>
          <article className="feat">
            <h3>Link</h3>
            <p>
              A new puzzle each day: get from one thing to another in as few
              links as you can.
            </p>
            <Link
              className="btn"
              href="/link"
              style={{ alignSelf: "flex-start" }}
            >
              Play today&rsquo;s puzzle
            </Link>
          </article>
          <article className="feat">
            <h3>Craft</h3>
            <p>
              Start with only the big bang and build your way to a pencil, a
              phone or a city.
            </p>
            <Link
              className="btn"
              href="/craft"
              style={{ alignSelf: "flex-start" }}
            >
              Start building
            </Link>
          </article>
        </section>

        <section className="feat wide">
          <div className="ftext">
            <h3>How we know</h3>
            <p>
              Links carry evidence: what supports them, what argues against
              them, and the sources behind it. Each link gets a confidence
              level, so you can tell settled science from open questions.
              Where scientists genuinely disagree, like where life began, the
              map shows each idea side by side.
            </p>
            <p>
              The evidence was researched with the help of Claude, an AI model
              made by Anthropic, using real published sources. It has not yet
              been reviewed by experts, so it may contain mistakes.
            </p>
          </div>
          <div className="fvis">
            <div className="vis-cap">Evidence across the map</div>
            <div className="aev">
              <div className="tot">
                <b>{evidencedLinkCount}</b>of {totalLinks} links have evidence,
                from {sourceCount} sources
              </div>
              {CONF_ORDER.map((k) => (
                <div
                  key={k}
                  className="row2"
                  style={
                    {
                      "--cc": `var(${CONF_META[k].cssVar})`,
                    } as React.CSSProperties
                  }
                >
                  <span className="lab">
                    <span
                      className="evb"
                      data-c={k}
                      style={
                        {
                          "--cc": `var(${CONF_META[k].cssVar})`,
                          width: 12,
                          height: 12,
                        } as React.CSSProperties
                      }
                      aria-hidden="true"
                    />
                    {CONF_META[k].label}
                  </span>
                  <span className="track">
                    <span
                      className="fill"
                      style={{
                        width: `${Math.round(((byConf[k] || 0) / confMax) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="n">{byConf[k] || 0}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="feat">
          <h3>What&rsquo;s simplified</h3>
          <p>Any map leaves things out. These are the biggest simplifications in this one:</p>
          <ul className="dots">
            <li>
              <b>It&rsquo;s small.</b> {itemCount} items stand in for millions
              of real things, and some chains are much deeper than others.
            </li>
            <li>
              <b>The tree of life is a single line.</b> Fish &ldquo;evolved
              from early animals&rdquo; rather than from a specific ancestor,
              and real family trees branch far more.
            </li>
            <li>
              <b>Materials are generalised.</b> &ldquo;Steel&rdquo; stands for
              hundreds of grades, and many links pick the most common way
              something is made.
            </li>
            <li>
              <b>Dates are first appearances,</b> and many are approximate.
              Where nobody knows, the map says so.
            </li>
          </ul>
        </section>

        <section className="feat">
          <h3>Inspired by</h3>
          <ul className="dots">
            <li>
              <b>&ldquo;I, Pencil&rdquo; (1958),</b> Leonard Read&rsquo;s essay
              pointing out that no single person knows how to make a pencil.
            </li>
            <li>
              <b>The Toaster Project,</b> in which Thomas Thwaites tried to
              build a toaster from raw materials.
            </li>
            <li>
              Every child who has asked &ldquo;but where does <i>that</i>{" "}
              come from?&rdquo; one more time.
            </li>
          </ul>
        </section>

        <section className="feat">
          <h3>Get in touch</h3>
          <p>
            Spotted a mistake, or want to suggest something for the map?
            A way to report it is coming soon, along with contact details for
            teachers, parents and sponsors.
          </p>
        </section>
      </div>

      <Footer />
    </main>
  );
}
