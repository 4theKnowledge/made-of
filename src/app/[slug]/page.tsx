import { notFound, permanentRedirect } from "next/navigation";
import { getItemPage } from "@/graph/queries";

/**
 * Soft forwarder: `/<slug>` → `/i/<slug>` for known item slugs. External
 * links written before the `/i/<slug>` move still work. Unknown slugs 404.
 *
 * Reserved paths (/explore, /scratch, /pricing, /about, /api, /i, etc.)
 * resolve to their own route and never hit this catch-all because Next's
 * router picks static > dynamic.
 */

export const dynamic = "force-dynamic";

const RESERVED = new Set([
  "api",
  "i",
  "explore",
  "scratch",
  "pricing",
  "about",
  "account",
  "admin",
  "sitemap.xml",
  "robots.txt",
  "llms.txt",
  "favicon.ico",
]);

export default async function LegacyItemRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (RESERVED.has(slug)) notFound();
  const item = await getItemPage(slug);
  if (!item) notFound();
  // 308 permanent so the old URL doesn't keep ranking.
  permanentRedirect(`/i/${slug}`);
}
