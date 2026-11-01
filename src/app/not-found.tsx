import Link from "next/link";
import { getLiveSnapshot } from "@/graph/live";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { Chip } from "@/components/Chip";
import { cap } from "@/lib/taxonomy";

/** Familiar items we'd like to suggest first on the 404. Any that aren't
 * live in the current snapshot are silently skipped. */
const POPULAR = [
  "water",
  "steel",
  "bread",
  "pencil",
  "smartphone",
  "tree",
  "internet",
  "gold",
];

export default async function NotFound() {
  let picks: Array<{
    id: string;
    name: string;
    tier: Parameters<typeof Chip>[0]["tier"];
    kind: Parameters<typeof Chip>[0]["kind"];
    symbol: string | null;
  }> = [];
  try {
    const live = await getLiveSnapshot();
    picks = POPULAR.map((slug) => live.snapshot.bySlug.get(slug))
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .slice(0, 6)
      .map((n) => ({
        id: n.slug,
        name: n.name,
        tier: n.tier,
        kind: n.kind,
        symbol: n.symbol,
      }));
  } catch {
    /* Snapshot can be unavailable in some error paths; fall back to buttons. */
  }

  return (
    <main className="wrap">
      <Header />

      <section className="phero">
        <span className="eyebrow">404</span>
        <h2>That page isn&rsquo;t on the map.</h2>
        <p>
          Maybe a typo, maybe something that doesn&rsquo;t exist here yet. Pick
          up a thread from one of these, or play today&rsquo;s puzzle.
        </p>
      </section>

      {picks.length > 0 && (
        <section className="feat">
          <h3>Start somewhere familiar</h3>
          <div
            className="chips"
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            {picks.map((p) => (
              <Chip
                key={p.id}
                slug={p.id}
                name={cap(p.name)}
                tier={p.tier}
                kind={p.kind}
                symbol={p.symbol}
              />
            ))}
          </div>
        </section>
      )}

      <section className="feat">
        <h3>Or try a mode</h3>
        <div className="row" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/" className="btn primary">
            Play Combine
          </Link>
          <Link href="/link" className="btn">
            Today&rsquo;s Link puzzle
          </Link>
          <Link href="/explore/water" className="btn">
            Explore
          </Link>
          <Link href="/craft" className="btn">
            Craft
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}
