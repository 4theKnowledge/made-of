import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // typedRoutes stayed experimental in Next 15 and makes dynamic `/[slug]`
  // links painful; the extra safety isn't worth it at this phase.
  experimental: {},
  // PostHog uses a reverse-proxy under /ingest so ad-blockers don't swallow
  // analytics and the host isn't baked into the client bundle. The hop is
  // documented in docs/POSTHOG.md.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
    const assetHost = host.replace("us.i.posthog.com", "us-assets.i.posthog.com");
    return [
      { source: "/ingest/static/:path*", destination: `${assetHost}/static/:path*` },
      { source: "/ingest/:path*", destination: `${host}/:path*` },
      { source: "/ingest/decide", destination: `${host}/decide` },
    ];
  },
  async redirects() {
    return [
      { source: "/scratch", destination: "/craft", permanent: true },
      { source: "/daily", destination: "/link", permanent: true },
    ];
  },
};

export default nextConfig;
