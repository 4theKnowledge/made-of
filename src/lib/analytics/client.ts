"use client";

import posthog from "posthog-js";

let initialised = false;

export function initPostHog(opts: {
  key: string;
  host: string;
  env: "production" | "preview" | "development";
}) {
  if (initialised || typeof window === "undefined") return;
  initialised = true;

  posthog.init(opts.key, {
    api_host: "/ingest",
    ui_host: opts.host,
    person_profiles: "identified_only",
    disable_session_recording: true,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    loaded: (ph) => {
      ph.register({ environment: opts.env });
    },
  });
}

export function identifyUser(userId: string) {
  if (typeof window === "undefined" || !initialised) return;
  if (posthog.get_distinct_id() === userId) return;
  posthog.identify(userId);
}

export function resetUser() {
  if (typeof window === "undefined" || !initialised) return;
  posthog.reset();
}

export function capture(event: string, props?: Record<string, unknown>) {
  if (typeof window === "undefined" || !initialised) return;
  posthog.capture(event, props);
}
