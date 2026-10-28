import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // typedRoutes stayed experimental in Next 15 and makes dynamic `/[slug]`
  // links painful; the extra safety isn't worth it at this phase.
  experimental: {},
};

export default nextConfig;
