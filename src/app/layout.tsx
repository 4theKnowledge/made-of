import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Suspense } from "react";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";
import { resolveEnv } from "@/lib/analytics/env";

export const metadata: Metadata = {
  title: "Made Of",
  description:
    "What is anything made of, traced back to the big bang, with sourced evidence for every link.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#101014",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const phKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const phHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  return (
    <html lang="en">
      <body>
        <Suspense fallback={null}>
          <PostHogProvider phKey={phKey} phHost={phHost} env={resolveEnv()} />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
