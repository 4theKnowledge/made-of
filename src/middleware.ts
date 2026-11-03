import { getSessionCookie } from "better-auth/cookies";
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

// Routes reachable without a session when STEALTH_MODE=1. Everything else
// is bounced to /sign-in. Auth endpoints must stay open so the magic link
// round-trip works; terms/privacy stay open because the sign-in form links
// to them.
const STEALTH_PUBLIC_PREFIXES = [
  "/sign-in",
  "/api/sign-in",
  "/api/auth",
  "/api/dev/sign-in",
  "/api/health",
  "/terms",
  "/privacy",
  "/favicon.ico",
  "/icon",
  "/apple-icon",
  "/email",
];

function isStealthPublic(pathname: string): boolean {
  return STEALTH_PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}.`),
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Stealth gate: when STEALTH_MODE=1, require a session cookie for every
  // route except the sign-in flow and a short allowlist. We only check the
  // cookie's presence here (middleware runs on the Edge, no DB); the real
  // session is still validated server-side by getSession() wherever it
  // matters. Flip STEALTH_MODE off to open the site publicly.
  if (process.env.STEALTH_MODE === "1" && !isStealthPublic(pathname)) {
    const hasSession = getSessionCookie(req, { cookiePrefix: "madeof" });
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = "/sign-in";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  // Explicit kill switch: used while Cloudflare isn't yet in front of the
  // Railway domain. Without this, the service is unreachable from a browser
  // because every request lacks the Cloudflare-injected header. Remove the
  // env var once Cloudflare is live. See docs/SERVICES.md → Cloudflare.
  if (process.env.ORIGIN_LOCK_DISABLED === "1") return NextResponse.next();

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
