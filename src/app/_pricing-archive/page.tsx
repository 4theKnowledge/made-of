import type { Metadata } from "next";
import Link from "next/link";
import { getLiveSnapshot } from "@/graph/live";
import { ancestors, upstreamWithin } from "@/graph/snapshot";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { Chip } from "@/components/Chip";
import { Pictogram } from "@/pictograms/Pictogram";
import { getDb, schema } from "@/db/client";
import { TIER, TIER_ORDER, cap } from "@/lib/taxonomy";
import type { GraphNode } from "@/graph/types";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Pricing · Made Of",
  description:
    "Made Of is free for everyone. Family and Educator plans add tools for home and classroom learning.",
  alternates: { canonical: "/pricing" },
};

const TRAILS: Array<[string, string]> = [
  ["Trace your breakfast to the stars", "bread"],
  ["How is a phone made?", "smartphone"],
  ["From fish to you", "humans"],
  ["Where did life begin?", "luca"],
  ["Why pencils are hard to make", "pencil"],
];

const SPONSOR_TRAIL = [
  "luca",
  "fish",
  "amphibians",
  "synapsids",
  "mammals",
  "primates",
  "humans",
];

export default async function PricingPage() {
  const live = await getLiveSnapshot();
  const db = getDb();
  const [{ count: evCount } = { count: 0 }] = await db
    .selectDistinct({ count: schema.linkEvidence.linkId })
    .from(schema.linkEvidence)
    .then((rows) => [{ count: rows.length }]);

  const nodes = live.snapshot.nodes;
  const bySlug = live.snapshot.bySlug;
  const itemCount = nodes.size;
  const elementCount = [...nodes.values()].filter(
    (n) => n.kind === "element",
  ).length;

  const nodeBySlug = (slug: string): GraphNode | undefined => bySlug.get(slug);
  const idForSlug = (slug: string): string | null =>
    bySlug.get(slug)?.id ?? null;
  const upstreamSlug = (slug: string, depth: number): Set<string> => {
    const id = idForSlug(slug);
    return id ? upstreamWithin(live.snapshot, id, depth) : new Set();
  };
  const ancestorsSlug = (slug: string): Set<string> => {
    const id = idForSlug(slug);
    return id ? ancestors(live.snapshot, id) : new Set();
  };

  // Difficulty-levels bars: how much of the pencil's upstream each depth
  // reveals. Mirrors prototype line 2532.
  const target = "pencil";
  const simple = upstreamSlug(target, 2);
  const standard = upstreamSlug(target, 5);
  const all = ancestorsSlug(target);
  const depthLevels: Array<[string, Set<string>, string]> = [
    ["Simple", simple, "--tN"],
    ["Standard", standard, "--tM"],
    ["Complex", all, "--tP"],
  ];
  const famNodes = [...upstreamSlug(target, 1)]
    .map((id) => nodes.get(id))
    .filter((n): n is GraphNode => Boolean(n));

  // Coverage mock: an example learner's seen set, built from pencil + bread
  // + humans upstreams. Mirrors prototype line 2544. Keyed by node uuid.
  const seen = new Set<string>();
  const seedSlug = (slug: string) => {
    const id = idForSlug(slug);
    if (id) seen.add(id);
  };
  seedSlug("pencil");
  seedSlug("bread");
  for (const id of upstreamSlug("pencil", 3)) seen.add(id);
  for (const id of upstreamSlug("bread", 2)) seen.add(id);
  for (const id of upstreamSlug("humans", 4)) seen.add(id);
  const sortedItems = [...nodes.values()].sort(
    (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier),
  );
  const seenCount = sortedItems.filter((i) => seen.has(i.id)).length;
  const coveragePct = Math.round((seenCount / itemCount) * 100);
  const tierCoverage = TIER_ORDER.map((t) => {
    const inTier = sortedItems.filter((i) => i.tier === t);
    const seenInTier = inTier.filter((i) => seen.has(i.id)).length;
    return { tier: t, seen: seenInTier, total: inTier.length };
  });

  // Goals mock, using real totals. Mirrors prototype line 2553.
  const elementNodes = [...nodes.values()].filter((n) => n.kind === "element");
  const elementSeen = elementNodes.filter((n) => seen.has(n.id)).length;
  const livingNodes = [...nodes.values()].filter((n) => n.kind === "living");
  const livingSeen = livingNodes.filter((n) => seen.has(n.id)).length;
  const goalRows = [
    {
      node: nodeBySlug("gold"),
      title: "Meet every element",
      done: elementSeen,
      total: Math.max(1, elementNodes.length),
      label: null as string | null,
    },
    {
      node: nodeBySlug("luca"),
      title: "Explore the tree of life",
      done: livingSeen,
      total: Math.max(1, livingNodes.length),
      label: null,
    },
    {
      node: nodeBySlug("pencil"),
      title: "Make a pencil in under 5 minutes",
      done: 1,
      total: 1,
      label: "Done in 4:12",
    },
    {
      node: nodeBySlug("big-bang"),
      title: "Daily link streak",
      done: 3,
      total: 5,
      label: "3 of 5 days",
    },
  ].filter(
    (g): g is typeof g & { node: GraphNode } => Boolean(g.node),
  );

  // Weekly mock items (pure example, but uses real nodes for the icons).
  const weeklyDone = nodeBySlug("humans");
  const weeklyFav = nodeBySlug("neutron-star-merger");
  const weeklyBadge = nodeBySlug("gold");

  // Sponsor trail chain + icon for humans.
  const sponsorChain = SPONSOR_TRAIL.map((slug) => nodeBySlug(slug)).filter(
    (n): n is GraphNode => Boolean(n),
  );
  const sponsorHero = nodeBySlug("humans");

  // Junior example: sheep.
  const juniorNode = nodeBySlug("sheep");

  // Guided trails list.
  const trails = TRAILS.map(([title, slug]) => {
    const n = nodeBySlug(slug);
    if (!n) return null;
    return { title, node: n, count: ancestors(live.snapshot, n.id).size };
  }).filter(
    (t): t is NonNullable<typeof t> => Boolean(t),
  );

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

        <section className="feat-head">
          <h2>What the family version adds</h2>
          <p>
            For a child exploring on their own, with a parent who can see what
            they&rsquo;re learning.
          </p>
        </section>

        <section className="feat wide">
          <div className="ftext">
            <h3>Learning at home, at their own pace</h3>
            <p>
              Each child gets their own profile, so their progress, badges and
              From scratch records are theirs. Trails they can follow alone
              turn curiosity into a goal, and badges give them a reason to
              come back.
            </p>
            <ul className="dots">
              <li>
                <b>Child profiles:</b> one per child, each set to their own
                level.
              </li>
              <li>
                <b>Badges and collections:</b> collect all{" "}
                <span className="fcount">{elementCount}</span> elements, trace
                five things back to the stars, build a phone from scratch.
              </li>
              <li>
                <b>Weekly summary:</b> what each child explored, finished and
                found most interesting, with a question to ask them at dinner.
              </li>
              <li>
                <b>Safe by design:</b> no ads, no chat with strangers and no
                public leaderboards.
              </li>
            </ul>
          </div>
          <div className="fvis">
            <div className="vis-cap">Example weekly summary</div>
            <div className="weekly">
              <div className="wh">
                <b>Maya&rsquo;s week</b>
                <span>Example</span>
              </div>
              <div className="wstats">
                <div>
                  <b>23</b>
                  <span>things explored</span>
                </div>
                <div>
                  <b>1</b>
                  <span>trail finished</span>
                </div>
                <div>
                  <b>3</b>
                  <span>badges</span>
                </div>
              </div>
              <div className="wl">
                {weeklyDone && (
                  <div>
                    <Pictogram
                      name={weeklyDone.name}
                      tier={weeklyDone.tier}
                      kind={weeklyDone.kind}
                      symbol={weeklyDone.symbol}
                    />
                    Finished the trail <b>From fish to you</b>
                  </div>
                )}
                {weeklyFav && (
                  <div>
                    <Pictogram
                      name={weeklyFav.name}
                      tier={weeklyFav.tier}
                      kind={weeklyFav.kind}
                      symbol={weeklyFav.symbol}
                    />
                    Most visited: <b>Neutron star merger</b>
                  </div>
                )}
                {weeklyBadge && (
                  <div>
                    <Pictogram
                      name={weeklyBadge.name}
                      tier={weeklyBadge.tier}
                      kind={weeklyBadge.kind}
                      symbol={weeklyBadge.symbol}
                    />
                    New badge: <b>Gold hunter</b>
                  </div>
                )}
              </div>
              <p className="ask">
                <b>Ask her:</b> Where might the gold in your ring have come
                from?
              </p>
            </div>
          </div>
        </section>

        <section className="feat-head">
          <h2>In both Family and Educator</h2>
          <p>
            Progress that&rsquo;s saved, goals to aim for, and ways to pitch
            the same map at the right level for each learner.
          </p>
        </section>

        <section className="feat wide">
          <div className="ftext">
            <h3>Your map of everything</h3>
            <p>
              Every item a learner visits is saved, so they can see how much
              of the map they&rsquo;ve uncovered and pick up where they left
              off. The unexplored parts become something to go and find.
            </p>
            <ul className="dots">
              <li>
                <b>Saved exploration trees:</b> revisit any path taken, like
                &ldquo;shirt, thread, cotton, cotton gin&rdquo;.
              </li>
              <li>
                <b>Coverage:</b> how much of the map has been discovered,
                overall and by tier.
              </li>
              <li>
                <b>Nearby unknowns:</b> suggestions for the closest things not
                yet seen.
              </li>
            </ul>
          </div>
          <div className="fvis">
            <div className="vis-cap">Example: a learner&rsquo;s map so far</div>
            <div className="cover">
              <div className="big">
                <b>
                  {seenCount} of {itemCount}
                </b>
                <span>
                  things discovered · {coveragePct}% of the map
                </span>
              </div>
              <div className="dotgrid" aria-hidden="true">
                {sortedItems.map((i) => (
                  <i
                    key={i.id}
                    className={seen.has(i.id) ? "on" : ""}
                    style={
                      {
                        "--c": `var(${TIER[i.tier].var})`,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </div>
              <div className="tl">
                {tierCoverage.map(({ tier, seen: k, total: n }) => (
                  <span
                    key={tier}
                    style={
                      { "--c": `var(${TIER[tier].var})` } as React.CSSProperties
                    }
                  >
                    {TIER[tier].name} {k}/{n}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="feat wide">
          <div className="ftext">
            <h3>Goals</h3>
            <p>
              Learners set their own goals, or a parent or teacher sets them.
              Progress fills in as they explore and play, so there&rsquo;s
              always a next thing to work towards.
            </p>
            <ul className="dots">
              <li>
                <b>Discovery goals:</b> meet every element, or explore all of
                the tree of life.
              </li>
              <li>
                <b>Game goals:</b> beat a From scratch time, or keep a Daily
                link streak going.
              </li>
              <li>
                <b>Set by grown-ups:</b> a teacher sets a goal for the class;
                a parent sets one for the week.
              </li>
            </ul>
          </div>
          <div className="fvis">
            <div className="vis-cap">Example goals</div>
            <div className="goals">
              {goalRows.map((g, idx) => {
                const done = g.done >= g.total;
                const pct = Math.round((g.done / g.total) * 100);
                return (
                  <div key={idx} className={`goal${done ? " done" : ""}`}>
                    <Pictogram
                      name={g.node.name}
                      tier={g.node.tier}
                      kind={g.node.kind}
                      symbol={g.node.symbol}
                    />
                    <span className="gt">{g.title}</span>
                    <span className="gn">
                      {g.label ?? `${g.done} / ${g.total}`}
                    </span>
                    <span className="gbar">
                      <span style={{ width: `${pct}%` }} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="feat wide">
          <div className="ftext">
            <h3>Difficulty levels</h3>
            <p>
              The same map, cut to the right depth. Simple hides long chains
              so younger students see a few familiar steps. Complex keeps
              every step, down to the elements, with debated links front and
              centre.
            </p>
            <ul className="dots">
              <li>
                <b>Simple:</b> two steps upstream, the most familiar items,
                short From scratch targets.
              </li>
              <li>
                <b>Standard:</b> the map as it is today.
              </li>
              <li>
                <b>Complex:</b> full-depth chains like the microchip, with
                evidence on every link.
              </li>
            </ul>
          </div>
          <div
            className="fvis"
            aria-label="How much of the map each level shows"
          >
            <div className="vis-cap">
              What goes into a {target}, at each level
            </div>
            {depthLevels.map(([name, set, cssVar], i) => {
              const pct = Math.max(
                4,
                Math.round((set.size / Math.max(1, all.size)) * 100),
              );
              return (
                <div key={name}>
                  <div
                    className="dbar"
                    style={{ "--c": `var(${cssVar})` } as React.CSSProperties}
                  >
                    <span className="lv">{name}</span>
                    <span className="track">
                      <span className="fill" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="n">{set.size} things</span>
                  </div>
                  {i === 0 && famNodes.length > 0 && (
                    <div className="dchips">
                      {famNodes.map((n) => (
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="feat wide">
          <div className="ftext">
            <h3>A junior interface</h3>
            <p>
              A calmer screen for ages 7 to 10: big icons, short words and
              fewer choices at once. Facts can be read aloud, and evidence
              labels become plain phrases like &ldquo;scientists agree&rdquo;
              or &ldquo;scientists still argue&rdquo;.
            </p>
            <ul className="dots">
              <li>Age bands: 7 to 10, 11 to 14, and 15 and up.</li>
              <li>At most four choices on each side of the bowtie.</li>
              <li>
                Simpler wording for every fact, checked for reading level.
              </li>
            </ul>
          </div>
          <div className="fvis">
            <div className="vis-cap">Junior view</div>
            {juniorNode && (
              <div className="junior">
                <Pictogram
                  name={juniorNode.name}
                  tier={juniorNode.tier}
                  kind={juniorNode.kind}
                  symbol={juniorNode.symbol}
                />
                <h4>Sheep</h4>
                <p>
                  Sheep grow wool. People cut it off once a year to make
                  clothes.
                </p>
                <div className="jb">
                  <span>← What it needs</span>
                  <span>What it makes →</span>
                </div>
                <span className="say">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 9h4l5-4v14l-5-4H4z" />
                    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
                  </svg>{" "}
                  Read it to me
                </span>
              </div>
            )}
          </div>
        </section>

        <section className="feat-head">
          <h2>What the educator version adds</h2>
          <p>
            These are the features we plan to build. Tell us which would
            matter most in your classroom.
          </p>
        </section>

        <section className="fgrid">
          <article className="feat tall">
            <h3>Lesson plans and guided trails</h3>
            <p>
              Ready-to-teach routes through the map, each with teacher notes,
              discussion questions and a short quiz.
            </p>
            <ul className="trails">
              {trails.map((t) => (
                <li key={t.node.id}>
                  <Pictogram
                    name={t.node.name}
                    tier={t.node.tier}
                    kind={t.node.kind}
                    symbol={t.node.symbol}
                  />
                  <span>{t.title}</span>
                  <span className="n">{t.count} things</span>
                </li>
              ))}
            </ul>
            <p className="small">
              Each plan will be matched to science and geography topics in
              common curricula.
            </p>
          </article>
          <article className="feat">
            <h3>A class space</h3>
            <p>
              Students join with a class code, with no email needed, and play
              together.
            </p>
            <ul className="dots">
              <li>
                A class Daily link, with everyone&rsquo;s results side by side.
              </li>
              <li>
                Team From scratch: split a build like a phone across groups.
              </li>
              <li>Live challenges the teacher starts for the whole room.</li>
              <li>Leaderboards are optional and off by default.</li>
            </ul>
          </article>
          <article className="feat">
            <h3>Teacher dashboard</h3>
            <p>
              See who has played, which trails they finished and where they
              got stuck.
            </p>
            <ul className="dots">
              <li>Progress by student and by trail.</li>
              <li>Hints used and common wrong turns.</li>
              <li>Assign a trail or a puzzle for homework.</li>
            </ul>
          </article>
          <article className="feat">
            <h3>Evidence skills</h3>
            <p>
              Use the evidence on each link to teach how we know what we know.
            </p>
            <ul className="dots">
              <li>Students sort evidence into For and Against.</li>
              <li>
                Lessons built on debated links, like where life began.
              </li>
              <li>
                Students propose new links with a source, for the teacher to
                approve.
              </li>
            </ul>
          </article>
          <article className="feat">
            <h3>Privacy and school setup</h3>
            <p>Built for schools from the start.</p>
            <ul className="dots">
              <li>No ads and as little student data as possible.</li>
              <li>Sign in with school Google or Microsoft accounts.</li>
              <li>Licences for a single class or a whole school.</li>
            </ul>
          </article>
        </section>

        <section className="feat-head" id="sponsorSec">
          <h2>Sponsor a trail or section</h2>
          <p>
            Museums, science centres, societies and foundations can help keep
            Made Of free by sponsoring part of the map. Sponsors get a clear
            credit where it&rsquo;s relevant. They never get a say in what the
            map says.
          </p>
        </section>

        <section className="feat wide">
          <div className="ftext">
            <h3>What sponsors get</h3>
            <ul className="dots">
              <li>
                A &ldquo;made possible by&rdquo; credit on a trail or a
                section of the map, like the tree of life or the story of the
                microchip.
              </li>
              <li>A listing on the supporters page.</li>
              <li>
                Optional: a sponsored Daily link day, themed on your subject.
              </li>
            </ul>
            <h3 style={{ marginTop: "6px" }}>What sponsors don&rsquo;t get</h3>
            <ul className="dots">
              <li>
                Any influence over items, facts, links or evidence. Our
                evidence rules apply to every section, sponsored or not.
              </li>
              <li>Ads, tracking or data about learners.</li>
              <li>
                Sections where they have a stake. An oil company can&rsquo;t
                sponsor the oil chain, and a chipmaker can&rsquo;t sponsor the
                microchip.
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
          <div className="fvis">
            <div className="vis-cap">How a credit would look</div>
            <div className="sponsorMock">
              {sponsorHero && (
                <div className="sh">
                  <Pictogram
                    name={sponsorHero.name}
                    tier={sponsorHero.tier}
                    kind={sponsorHero.kind}
                    symbol={sponsorHero.symbol}
                  />
                  <b>Trail: From fish to you</b>
                </div>
              )}
              <div className="chainrow">
                {sponsorChain.map((n, i) => (
                  <span
                    key={n.id}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    {i > 0 && <span>→</span>}
                    <Chip
                      slug={n.slug}
                      name={cap(n.name)}
                      tier={n.tier}
                      kind={n.kind}
                      symbol={n.symbol}
                      size="sm"
                      as="span"
                    />
                  </span>
                ))}
              </div>
              <div className="credit">
                <span className="logo">LOGO</span>
                <span>
                  This trail is made possible by <b>Your organisation</b>.
                  Sponsors have no say over its content.
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="faq">
          <h2>Questions</h2>
          <details>
            <summary>Will the free version stay free?</summary>
            <p>
              Yes. Exploring, the Daily link, From scratch and all the
              evidence stay free for everyone.
            </p>
          </details>
          <details>
            <summary>Can I use Made Of in class today?</summary>
            <p>
              Yes. The free version works in any classroom now. The educator
              version adds structure: levels, lesson plans and a shared class
              space.
            </p>
          </details>
          <details>
            <summary>Is Made Of independent?</summary>
            <p>
              Yes. Sponsors and paying customers never decide what goes on the
              map. Every link follows the same evidence rules, and debated
              things stay marked as debated.
            </p>
          </details>
          <details>
            <summary>
              What&rsquo;s the difference between Family and Educator?
            </summary>
            <p>
              Family is for a parent and a few children at home: child
              profiles, badges and a weekly summary. Educator is for a teacher
              and a whole class: lesson plans, a shared class space and a
              dashboard. Both include difficulty levels and the junior
              interface.
            </p>
          </details>
          <details>
            <summary>
              When will the family and educator versions be ready?
            </summary>
            <p>
              Both are in development, and the features above may change as we
              learn what parents and teachers need.
            </p>
          </details>
        </section>
      </div>

      <Footer />
    </main>
  );
}
