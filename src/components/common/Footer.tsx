import Link from "next/link";
import { getSession } from "@/lib/session";
import { FeedbackLauncher } from "./FeedbackLauncher";


/**
 * Shared footer with legal links (Privacy, Terms, Method) and a global
 * "Feedback" entry point.
 *
 * `compactOnMobile` collapses to a single row on mobile for game pages
 * (Combine, Explore, Scratch) so the board isn't pushed down by a tall
 * stacked footer. Desktop is unchanged.
 */
export async function Footer({
  compactOnMobile = false,
}: { compactOnMobile?: boolean } = {}) {
  const session = await getSession();
  const signedIn = !!session?.user?.id;
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
        <Link href="/changelog">Changelog</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <FeedbackLauncher signedIn={signedIn} />
      </nav>
    </footer>
  );
}
