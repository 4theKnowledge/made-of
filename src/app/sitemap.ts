import type { MetadataRoute } from "next";
import { getLiveSnapshot } from "@/graph/live";

/**
 * Sitemap: every live item page, plus static entry points. Canaries are
 * excluded (we only emit entries for items visible on item pages).
 *
 * The base URL comes from NEXT_PUBLIC_SITE_URL in prod; falls back to the
 * localhost origin for dev so you can at least verify the shape.
 */
// Must run at request time: the sitemap reads from Postgres via the snapshot
// loader, which isn't available during `next build`.
export const dynamic = "force-dynamic";
export const revalidate = 3600;

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const live = await getLiveSnapshot();

  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/pricing`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/scratch`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
  ];

  const itemRoutes: MetadataRoute.Sitemap = [...live.snapshot.nodes.values()]
    .map((n) => ({
      url: `${BASE_URL}/i/${n.id}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));

  return [...staticRoutes, ...itemRoutes];
}
