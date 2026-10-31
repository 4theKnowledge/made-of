import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

// Build handlers lazily so `next build` doesn't construct the Better Auth
// instance (which would call getDb() + new Resend() with no env vars).
let handlers: ReturnType<typeof toNextJsHandler> | null = null;
function get() {
  if (!handlers) handlers = toNextJsHandler(getAuth());
  return handlers;
}

export async function GET(req: Request) {
  return get().GET(req);
}

export async function POST(req: Request) {
  return get().POST(req);
}
