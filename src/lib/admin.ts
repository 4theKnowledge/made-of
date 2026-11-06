import { NextResponse } from "next/server";
import { getSession } from "./session";
import {
  auditDb,
  InvariantViolation,
  formatAudit,
  isCleanAudit,
  type GraphAudit,
} from "@/data/invariants";
import type { DbExecutor } from "@/graph/load";

/**
 * Guard for admin API route handlers. Returns a NextResponse on failure
 * (401 if not signed in, 403 if signed in without the admin role) so
 * callers can early-return. Returns `null` on success — the caller then
 * knows the session is valid.
 *
 * This mirrors the UI gate in /admin/layout.tsx; both are enforced because
 * CLAUDE.md requires server-side entitlement checks, not just UI hiding.
 */
export async function requireAdminApi(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = (session.user as { role?: string } | undefined)?.role;
  if (role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * Run the graph-shape audit against the current DB state through the
 * given executor (pass `tx` from inside a transaction so uncommitted
 * writes are visible). If the audit fails, throws `InvariantViolation`
 * so the surrounding transaction rolls back — catch at the route
 * boundary with `isInvariantViolation` and return `invariantResponse`.
 */
export async function assertInvariants(executor: DbExecutor): Promise<void> {
  const audit = await auditDb(executor);
  if (!isCleanAudit(audit)) {
    throw new InvariantViolation(audit);
  }
}

/** Standard 422 shape for an audit-failure response. Matches the JSON the
 *  admin UI expects when surfacing the offender list. */
export function invariantResponse(audit: GraphAudit): NextResponse {
  return NextResponse.json(
    {
      error: "invariant_violation",
      message: formatAudit(audit),
      audit,
    },
    { status: 422 },
  );
}

/** Classifier for catch blocks that want to peel off an InvariantViolation
 *  and return 422 while rethrowing anything else. */
export function isInvariantViolation(err: unknown): err is InvariantViolation {
  return err instanceof InvariantViolation;
}
