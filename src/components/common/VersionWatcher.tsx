"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const DISMISS_PREFIX = "update-toast-dismissed:";
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const COMBINE_PREFIX = "/combine";
export const UPDATE_EVENT = "madeof:update-available";

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

export function VersionWatcher() {
  const pathname = usePathname();
  const myVersionRef = useRef<string | null>(null);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Boot: establish my version on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const v = await fetchVersion();
      if (!cancelled && v) myVersionRef.current = v;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll: on visibility-regain and on an interval.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!myVersionRef.current) return;
      const v = await fetchVersion();
      if (cancelled || !v) return;
      if (v !== myVersionRef.current) setServerVersion(v);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    // Admin debug can fire this to test the toast without a deploy.
    // detail.version overrides; default to a synthetic string.
    const onManual = (e: Event) => {
      const detail = (e as CustomEvent<{ version?: string }>).detail;
      setServerVersion(detail?.version || `test-${Date.now()}`);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(UPDATE_EVENT, onManual);
    const timer = setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(UPDATE_EVENT, onManual);
      clearInterval(timer);
    };
  }, []);

  // Honour prior per-version dismissal when a new server version appears.
  useEffect(() => {
    if (!serverVersion) return;
    try {
      if (localStorage.getItem(DISMISS_PREFIX + serverVersion)) {
        setDismissed(true);
      } else {
        setDismissed(false);
      }
    } catch {
      /* storage blocked — show anyway */
    }
  }, [serverVersion]);

  if (!serverVersion || dismissed) return null;

  // Don't interrupt an active Combine run. The pathname switch (user left the
  // board) is enough of an idle signal — they'll see the toast then.
  if (pathname?.startsWith(COMBINE_PREFIX)) return null;

  const onDismiss = () => {
    try {
      localStorage.setItem(DISMISS_PREFIX + serverVersion, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const onRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="update-toast" role="status" aria-live="polite">
      <span className="update-toast-body">
        A fresh version of Made Of is ready.
      </span>
      <button
        type="button"
        className="update-toast-refresh"
        onClick={onRefresh}
      >
        Refresh
      </button>
      <button
        type="button"
        className="update-toast-x"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
