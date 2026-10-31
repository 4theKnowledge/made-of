import Link from "next/link";

/**
 * Shared footer. Ported from legacy/made-of.html line 1083, with legal
 * links appended (Privacy, Terms, Method) for the live site.
 */
export function Footer() {
  return (
    <footer className="foot">
      <span className="fbrand">Made Of</span>
      <span>Free for everyone. No ads.</span>
      <span className="fsep" aria-hidden="true"></span>
      <span className="support" title="Donations open soon">
        Support Made Of <em>coming soon</em>
      </span>
      <Link href="/pricing#sponsorSec">Sponsor a section</Link>
      <Link href="/pricing">Pricing</Link>
      <Link href="/about">About</Link>
      <Link href="/method">Method</Link>
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
    </footer>
  );
}
