import type { MetadataRoute } from "next";

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * robots.txt per CLAUDE.md's hard rule:
 *   - allow search engines and AI search / citation crawlers on item pages
 *   - block AI training crawlers everywhere
 *   - block /api/ and /admin/ for all
 *
 * The lists below reflect the generally accepted bot user agents at the time
 * of writing. We err on the side of blocking training-only bots and allowing
 * citation-oriented bots that link back to source URLs.
 */
export default function robots(): MetadataRoute.Robots {
  const trainingBots = [
    "GPTBot",
    "ClaudeBot-training",
    "anthropic-ai",
    "Google-Extended",
    "Applebot-Extended",
    "cohere-ai",
    "CCBot",
    "Omgili",
    "FacebookBot",
    "Diffbot",
    "ImagesiftBot",
  ];

  return {
    rules: [
      // Everyone: no /api, no /admin.
      { userAgent: "*", disallow: ["/api/", "/admin/"] },
      // AI training crawlers: fully blocked.
      ...trainingBots.map((ua) => ({
        userAgent: ua,
        disallow: "/",
      })),
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
