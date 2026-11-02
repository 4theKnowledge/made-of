import Link from "next/link";

/**
 * Shared footer with legal links (Privacy, Terms, Method).
 *
 * `compactOnMobile` collapses to a single row on mobile for game pages
 * (Combine, Explore, Scratch) so the board isn't pushed down by a tall
 * stacked footer. Desktop is unchanged.
 */
export function Footer({ compactOnMobile = false }: { compactOnMobile?: boolean } = {}) {
  return (
    <footer className="foot" data-compact-on-mobile={compactOnMobile ? "" : undefined}>
      <div className="footBrand">
        <span className="fbrand">Made Of</span>
        <span className="ftag">Free for everyone. No ads.</span>
      </div>
      <span className="fsep" aria-hidden="true"></span>
      <span className="support" title="Donations open soon">
        Support Made Of <em>coming soon</em>
      </span>
      <nav className="footLinks" aria-label="Site">
        <Link href="/pricing#sponsorSec">Sponsor a section</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/about">About</Link>
        <Link href="/method">Method</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </nav>
    </footer>
  );
}
