import { NextResponse, type NextRequest } from "next/server";

/**
 * Origin lock: Cloudflare adds the `x-origin-lock` header to every proxied
 * request through a Transform Rule. If a request reaches us without that
 * header, it skipped Cloudflare (hit the Railway domain directly) and is
 * rejected.
 *
 * The lock is bypassed when NODE_ENV !== "production" so local development
 * works without configuring the secret.
 *
 * See docs/SERVICES.md → Cloudflare → Transform Rule for the setup.
 */

const HEADER = "x-origin-lock";

export function middleware(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  const expected = process.env.ORIGIN_LOCK_SECRET;
  if (!expected) {
    // Fail closed: if the secret is missing in production, something is
    // misconfigured. Return 503 so a monitor notices rather than silently
    // letting bots in.
    return new NextResponse("Origin lock not configured", { status: 503 });
  }

  const got = req.headers.get(HEADER);
  if (got !== expected) {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  // Health check is unlocked so Railway can reach it from inside the private
  // network without the Cloudflare header.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
