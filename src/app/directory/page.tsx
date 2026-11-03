import type { Metadata } from "next";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getLiveSnapshot } from "@/graph/live";
import type { Tier, ItemKind } from "@/db/schema";
import { IndexList, type IndexEntry } from "./IndexList";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Directory · Made Of",
  description:
    "Every item in Made Of, A to Z. Tap any name to see what it is made of.",
  alternates: { canonical: "/directory" },
};

export default async function DirectoryPage() {
  const live = await getLiveSnapshot();

  const entries: IndexEntry[] = [];
  for (const node of live.snapshot.nodes.values()) {
    // Canaries live only in API responses — never on the Index, item pages,
    // sitemap, or llms.txt. See the "Only live content is public" hard rule.
    if (node.isCanary) continue;
    entries.push({
      slug: node.slug,
      name: node.name,
      tier: node.tier as Tier,
      kind: node.kind as ItemKind,
      symbol: node.symbol ?? null,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="wrap">
      <Header current="directory" />

      <section className="phero" style={{ paddingBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Directory</h2>
        <p className="sub" style={{ margin: "4px 0 0" }}>
          Everything in Made Of, A to Z. {entries.length} items.
        </p>
      </section>

      <IndexList entries={entries} />

      <Footer compactOnMobile />
    </main>
  );
}
