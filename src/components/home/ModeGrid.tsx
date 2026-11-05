import Link from "next/link";
import type { ReactNode } from "react";

interface Mode {
  href: string;
  title: string;
  blurb: string;
  cta: string;
  primary?: boolean;
  visual?: ReactNode;
}

export function ModeGrid({
  combineVisual,
  exploreVisual,
}: {
  combineVisual?: ReactNode;
  exploreVisual?: ReactNode;
}) {
  const modes: Mode[] = [
    {
      href: "/combine",
      title: "Combine",
      blurb:
        "Drag touching things together to make a third, and watch recipes chain. Endless, fast and daily modes, with a lifetime collection as you go.",
      cta: "Play today’s Combine",
      primary: true,
      visual: combineVisual,
    },
    {
      href: "/explore/water",
      title: "Explore",
      blurb:
        "Pick anything and see what it takes and what it leads to. Follow a thread as far as you like.",
      cta: "Start exploring",
      visual: exploreVisual,
    },
  ];

  return (
    <section className="homeModes">
      {modes.map((m) => (
        <article key={m.href} className="feat modeCard">
          <div className="modeCard-head">
            <div className="modeCard-text">
              <h3>{m.title}</h3>
              <p>{m.blurb}</p>
            </div>
            {m.visual && <div className="modeCard-viz">{m.visual}</div>}
          </div>
          <Link
            href={m.href}
            className={`btn${m.primary ? " primary" : ""}`}
            style={{ alignSelf: "flex-start", marginTop: "auto" }}
          >
            {m.cta}
          </Link>
        </article>
      ))}
    </section>
  );
}
