import Link from "next/link";

interface Mode {
  href: string;
  title: string;
  blurb: string;
  cta: string;
}

const MODES: Mode[] = [
  {
    href: "/combine",
    title: "Combine",
    blurb:
      "Drag touching things together to make a third, and watch recipes chain. Endless, fast and daily modes, with a lifetime collection as you go.",
    cta: "Play Combine",
  },
  {
    href: "/explore/water",
    title: "Explore",
    blurb:
      "Pick anything and see what it takes and what it leads to. Follow a thread as far as you like.",
    cta: "Start exploring",
  },
];

export function ModeGrid() {
  return (
    <section className="homeModes">
      {MODES.map((m) => (
        <article key={m.href} className="feat">
          <h3>{m.title}</h3>
          <p>{m.blurb}</p>
          <Link
            href={m.href}
            className="btn"
            style={{ alignSelf: "flex-start", marginTop: "auto" }}
          >
            {m.cta}
          </Link>
        </article>
      ))}
    </section>
  );
}
