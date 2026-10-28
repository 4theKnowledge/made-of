import type { Metadata } from "next";
import Link from "next/link";
import { getLiveSnapshot } from "@/graph/live";
import { Header } from "@/components/common/Header";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "About · Made Of",
  description:
    "A shirt needs thread, thread needs cotton, cotton needs a plant, and the plant needs sunlight from a star. Made Of maps those connections.",
  alternates: { canonical: "/about" },
};

export default async function AboutPage() {
  const live = await getLiveSnapshot();
  const itemCount = live.snapshot.nodes.size;

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

        <section className="fgrid">
          <article className="feat">
            <h3>Explore</h3>
            <p>
              Pick anything and see what it takes and what it leads to.
              Follow a thread as far as you like.
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
            <h3>Daily link</h3>
            <p>
              A new puzzle each day: get from one thing to another in as few
              links as you can.
            </p>
            <Link
              className="btn"
              href="/"
              style={{ alignSelf: "flex-start" }}
            >
              Play today&rsquo;s puzzle
            </Link>
          </article>
          <article className="feat">
            <h3>From scratch</h3>
            <p>
              Start with only the big bang and build your way to a pencil, a
              phone or a city.
            </p>
            <Link
              className="btn"
              href="/scratch"
              style={{ alignSelf: "flex-start" }}
            >
              Start building
            </Link>
          </article>
        </section>

        <section className="feat">
          <h3>How we know</h3>
          <p>
            Links carry evidence: what supports them, what argues against them,
            and the sources behind it. Each link gets a confidence level, so
            you can tell settled science from open questions. Where scientists
            genuinely disagree, like where life began, the map shows each idea
            side by side.
          </p>
          <p>
            The evidence was researched with the help of Claude, an AI model
            made by Anthropic, using real published sources. It has not yet
            been reviewed by experts, so it may contain mistakes.
          </p>
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
    </main>
  );
}
