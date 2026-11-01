import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Footer } from "@/components/common/Footer";
import { Header } from "@/components/common/Header";
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
      <Header current="explore" exploreHref={`/explore/${slug}`} />

      <ExploreShell view={view} />
      <Footer />
    </main>
  );
}
