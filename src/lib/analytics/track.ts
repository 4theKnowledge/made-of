"use client";

import { capture } from "./client";
import type { AnalyticsEvent } from "./events";

// Typed entry point for all client-side analytics. The discriminated union
// in ./events.ts enforces event names and property shapes — add a branch
// there, call it from here, done.
//
// Server-side capture goes through captureServer() in ./server.ts (server-
// only; not exported from this module).
export function track(event: AnalyticsEvent): void {
  // AnalyticsEvent is `never` until events are defined; the body still runs
  // once branches exist. Using `as` keeps the stub type-safe today.
  const e = event as unknown as { name: string; properties?: Record<string, unknown> };
  capture(e.name, e.properties);
}
