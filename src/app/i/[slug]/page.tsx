import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getItemPage, type PageEdge } from "@/graph/queries";
import { Chip } from "@/components/Chip";
import { Pictogram } from "@/pictograms/Pictogram";
import { TIER, KIND, tierColor } from "@/lib/taxonomy";
import { REL, RORDER } from "@/lib/rel";
import { formatFirstAppeared } from "@/lib/year";
import type { LinkType } from "@/db/schema";

export const dynamic = "force-static";
export const revalidate = 3600;

const TIER_FILL: Record<string, string> = {
  F: "var(--fF)",
  N: "var(--fN)",
  M: "var(--fM)",
  C: "var(--fC)",
  P: "var(--fP)",
  S: "var(--fS)",
};

interface Params {
  slug: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const item = await getItemPage(slug);
  if (!item) return { title: "Not found · Made Of" };
  const title = `${item.name} · Made Of`;
  const description = item.fact
    ? item.fact
    : `What ${item.name} is made of, traced back to the big bang.`;
  return {
    title,
    description,
    alternates: { canonical: `/i/${slug}` },
    openGraph: {
      title,
      description,
      type: "article",
    },
  };
}

export default async function ItemPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const item = await getItemPage(slug);
  if (!item) notFound();

  const yr = formatFirstAppeared(item.firstAppeared);

  // Group up-edges by type for the "Made from", "Needs", "Evolved from"...
  // panels. Order per RORDER (e, f, w, n, s), matching the prototype.
  const upByType = new Map<LinkType, PageEdge[]>();
  for (const e of item.up) {
    const arr = upByType.get(e.type) ?? [];
    arr.push(e);
    upByType.set(e.type, arr);
  }

  // Downstream (what this leads to) is one combined list.
  const down = item.down;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Thing",
    name: item.name,
    description: item.fact || undefined,
    url: `/i/${item.slug}`,
    identifier: item.slug,
    additionalType: `https://madeof.app/kinds/${item.kind}`,
    temporalCoverage: yr?.label,
  };

  return (
    <main
      className="wrap"
      style={
        {
          "--c": tierColor(item.tier),
          "--fill": TIER_FILL[item.tier],
        } as React.CSSProperties
      }
    >
      <header>
        <div className="brand">
          <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
            <h1>Made Of</h1>
          </Link>
          <span>Everything is made of something.</span>
        </div>
        <nav className="tabs" aria-label="Modes">
          <Link href="/">Daily link</Link>
          <Link href={`/explore/${item.slug}`}>Explore</Link>
          <Link href="/scratch">From scratch</Link>
        </nav>
      </header>

      {/* Focus card. Simplified from the Explore bowtie: just the item itself,
          with its fact and timeline. Panels below carry inputs and outputs. */}
      <section className="focus">
        <div className="fhead">
          <div className="fpic">
            <Pictogram
              name={item.name}
              tier={item.tier}
              kind={item.kind}
              symbol={item.symbol}
            />
            {item.kind !== "element" && item.symbol ? (
              <span className="fsym" aria-hidden="true">
                {item.symbol}
              </span>
            ) : null}
          </div>
          <h2>{item.name}</h2>
          <div className="tierline">
            <span className="pills">
              <span className="pill t">{TIER[item.tier].name}</span>
              <span className="pill">{KIND[item.kind]}</span>
            </span>
          </div>
        </div>
        {item.fact ? <p className="fact">{item.fact}</p> : null}
        <div className="when">
          <div className="wl">
            <span>First appeared</span>
            {yr ? (
              <b>{yr.label}</b>
            ) : (
              <b className="unknown">Date not yet known</b>
            )}
          </div>
        </div>
        <div className="factions">
          <Link
            href={`/explore/${item.slug}`}
            className="btn primary"
            style={{ textDecoration: "none" }}
          >
            Explore this
          </Link>
        </div>
      </section>

      {/* Up-side panels, grouped by relation type. */}
      {RORDER.map((rel) => {
        const edges = upByType.get(rel);
        if (!edges || edges.length === 0) return null;
        return (
          <section key={rel} className="panel">
            <h3>{REL[rel].group}</h3>
            {REL[rel].desc ? <p className="sub">{REL[rel].desc}</p> : null}
            <div className="cs">
              {edges.map((e) => (
                <Chip
                  key={e.linkCode}
                  slug={e.item.slug}
                  name={e.item.name}
                  tier={e.item.tier}
                  kind={e.item.kind}
                  symbol={e.item.symbol}
                  size="sm"
                />
              ))}
            </div>
          </section>
        );
      })}

      {down.length > 0 && (
        <section className="panel">
          <h3>Goes into</h3>
          <p className="sub">
            Where {item.name} shows up next in the chain.
          </p>
          <div className="cs">
            {down.map((e) => (
              <Chip
                key={e.linkCode}
                slug={e.item.slug}
                name={e.item.name}
                tier={e.item.tier}
                kind={e.item.kind}
                symbol={e.item.symbol}
                size="sm"
              />
            ))}
          </div>
        </section>
      )}

      <script
        type="application/ld+json"
        // Trusted static content — safe to inject.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}

export async function generateStaticParams() {
  // Phase 3 keeps this empty so pages render on demand (Next's ISR will
  // cache them). Phase 5 publishes trigger `revalidatePath('/[slug]')`.
  return [];
}
