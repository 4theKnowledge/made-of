import { getLiveSnapshot } from "@/graph/live";

export const runtime = "nodejs";
// Must run at request time: reads from Postgres via the snapshot loader.
export const dynamic = "force-dynamic";
export const revalidate = 3600;

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * /llms.txt — a plain list of item page URLs for AI search/citation
 * crawlers, as specified by the proposal at https://llmstxt.org/.
 *
 * Per CLAUDE.md's crawler rules: allow search engines and AI search or
 * citation crawlers on item pages. We emit a header block describing the
 * site, followed by one URL per line.
 *
 * Canaries are excluded. Only `status = live` items ship here.
 */
export async function GET() {
  const live = await getLiveSnapshot();

  const header = [
    "# Made Of",
    "",
    "> Everything is made of something. Made Of maps what things are made of, traced back to the big bang, with sourced evidence for every link.",
    "",
    "This file lists all public item pages. See https://llmstxt.org/ for the format.",
    "",
    "## Items",
    "",
  ].join("\n");

  const items = [...live.snapshot.nodes.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((n) => `- [${n.name}](${BASE_URL}/i/${n.id})`)
    .join("\n");

  const body = header + items + "\n";

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
