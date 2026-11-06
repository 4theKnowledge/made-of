"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { capture, identifyUser, initPostHog, resetUser } from "@/lib/analytics/client";

type Props = {
  phKey?: string;
  phHost?: string;
  env: "production" | "preview" | "development";
};

export function PostHogProvider({ phKey, phHost, env }: Props) {
  useEffect(() => {
    if (!phKey) return;
    initPostHog({ key: phKey, host: phHost ?? "https://us.i.posthog.com", env });
  }, [phKey, phHost, env]);

  return (
    <>
      <IdentifyBridge enabled={Boolean(phKey)} />
      <PageviewBridge enabled={Boolean(phKey)} />
    </>
  );
}

function IdentifyBridge({ enabled }: { enabled: boolean }) {
  const { data: session } = useSession();
  useEffect(() => {
    if (!enabled) return;
    if (session?.user?.id) {
      identifyUser(session.user.id);
    } else {
      resetUser();
    }
  }, [enabled, session?.user?.id]);
  return null;
}

function PageviewBridge({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    if (!enabled || !pathname) return;
    const qs = search?.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    capture("$pageview", { $current_url: url });
  }, [enabled, pathname, search]);
  return null;
}
