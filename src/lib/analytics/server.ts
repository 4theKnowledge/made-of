import "server-only";
import { PostHog } from "posthog-node";
import { resolveEnv } from "./env";

let client: PostHog | null = null;

function getClient(): PostHog | null {
  if (client) return client;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
  if (!key) return null;
  client = new PostHog(key, {
    host,
    flushAt: 20,
    flushInterval: 10_000,
  });
  return client;
}

export function captureServer(opts: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}) {
  const ph = getClient();
  if (!ph) return;
  ph.capture({
    distinctId: opts.distinctId,
    event: opts.event,
    properties: { environment: resolveEnv(), ...opts.properties },
  });
}

export async function shutdownPostHog() {
  if (!client) return;
  await client.shutdown();
  client = null;
}
