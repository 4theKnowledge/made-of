import Link from "next/link";
import { getLiveSnapshot } from "@/graph/live";

export default async function NotFound() {
  // Pick a random live item for the "browse" button so repeat visits don't
  // always suggest water.
  let randomSlug = "water";
  try {
    const live = await getLiveSnapshot();
    const slugs = [...live.snapshot.nodes.keys()];
    if (slugs.length > 0) {
      randomSlug = slugs[Math.floor(Math.random() * slugs.length)];
    }
  } catch {
    /* fallback to water if the snapshot can't load */
  }
  return (
    <main className="wrap">
      <header>
        <div className="brand">
          <h1>Made Of</h1>
          <span>Everything is made of something.</span>
        </div>
      </header>
      <section className="panel">
        <h3>That page isn&rsquo;t on the map.</h3>
        <p className="sub">
          Maybe a typo, maybe something that doesn&rsquo;t exist here yet.
        </p>
        <div className="row">
          <Link href="/" className="btn primary">
            Play today&rsquo;s Daily link
          </Link>
          <Link href={`/i/${randomSlug}`} className="btn">
            Browse an item ({randomSlug.replace(/-/g, " ")})
          </Link>
        </div>
      </section>
    </main>
  );
}
