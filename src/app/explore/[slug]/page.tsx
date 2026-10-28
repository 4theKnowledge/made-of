import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getExploreView } from "@/graph/explore";
import { ExploreShell } from "@/components/explore/ExploreShell";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const view = await getExploreView(slug);
  if (!view) return { title: "Not found · Made Of" };
  return {
    title: `Explore ${view.item.name} · Made Of`,
    description: `What ${view.item.name} is made of and what it goes into, traced back to the big bang.`,
    alternates: { canonical: `/explore/${slug}` },
  };
}

export default async function ExplorePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const view = await getExploreView(slug);
  if (!view) notFound();

  return (
    <main className="wrap">
      <header>
        <div className="brand">
          <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
            <h1>Made Of</h1>
          </Link>
          <span>Everything is made of something.</span>
        </div>
        <nav className="tabs" aria-label="Modes">
          <Link href="/">Daily link</Link>
          <Link href={`/explore/${slug}`} className="on">
            Explore
          </Link>
          <Link href="/scratch">From scratch</Link>
        </nav>
      </header>

      <ExploreShell view={view} />
    </main>
  );
}
