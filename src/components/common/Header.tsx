import Link from "next/link";

/**
 * Shared header, used by static pages and anywhere a page doesn't need to
 * compute per-item tab targets.
 */
export function Header({
  current,
}: {
  current?: "daily" | "explore" | "scratch" | "pricing" | "about";
}) {
  return (
    <header>
      <div className="brand">
        <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
          <h1>Made Of</h1>
        </Link>
        <span>Everything is made of something.</span>
      </div>
      <nav className="tabs" aria-label="Modes">
        <Link href="/" className={current === "daily" ? "on" : ""}>
          Daily link
        </Link>
        <Link
          href="/explore/water"
          className={current === "explore" ? "on" : ""}
        >
          Explore
        </Link>
        <Link href="/scratch" className={current === "scratch" ? "on" : ""}>
          From scratch
        </Link>
        <Link href="/pricing" className={current === "pricing" ? "on" : ""}>
          Pricing
        </Link>
        <Link href="/about" className={current === "about" ? "on" : ""}>
          About
        </Link>
      </nav>
    </header>
  );
}
