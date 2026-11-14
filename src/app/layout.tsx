import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Suspense } from "react";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";
import { SiteBanner } from "@/components/common/SiteBanner";
import { VersionWatcher } from "@/components/common/VersionWatcher";
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

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('madeof.theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  const phKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const phHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Suspense fallback={null}>
          <PostHogProvider phKey={phKey} phHost={phHost} env={resolveEnv()} />
        </Suspense>
        <SiteBanner />
        {children}
        <VersionWatcher />
      </body>
    </html>
  );
}
