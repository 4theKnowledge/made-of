"use client";

import { useEffect, useState } from "react";

interface ActiveBanner {
  id: string;
  body: string;
  severity: "info" | "warn" | "critical";
  dismissible: boolean;
}

const DISMISS_PREFIX = "site-banner-dismissed:";

/** Fetches the currently-live site banner (if any) and renders it above
 *  the page. Audience filtering happens on the server; this component just
 *  renders whatever the API returns. */
export function SiteBanner() {
  const [banner, setBanner] = useState<ActiveBanner | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/banners/active", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { banner: ActiveBanner | null };
        if (cancelled || !data.banner) return;
        if (data.banner.dismissible) {
          const key = DISMISS_PREFIX + data.banner.id;
          if (typeof window !== "undefined" && localStorage.getItem(key)) {
            return;
          }
        }
        setBanner(data.banner);
      } catch {
        /* silent — the banner is a nice-to-have */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!banner || dismissed) return null;

  const onDismiss = () => {
    if (banner.dismissible && typeof window !== "undefined") {
      localStorage.setItem(DISMISS_PREFIX + banner.id, "1");
    }
    setDismissed(true);
  };

  return (
    <div className={`sitebanner sitebanner-${banner.severity}`} role="status">
      <span className="sitebanner-body">{banner.body}</span>
      {banner.dismissible && (
        <button
          type="button"
          className="sitebanner-x"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}
