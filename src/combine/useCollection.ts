"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { clearFound, loadFound, markFound } from "./storage";

export type CollectionScope = "endless" | "daily";

/**
 * The player's Combine collection for the given `scope`:
 * `itemId → firstFoundAt (epoch ms)`.
 *
 * Scopes are fully independent. Endless (shared between Everyday and
 * Everything endless runs) is the historical "lifetime collection". Daily
 * has its own collection so each daily puzzle plays out from a scoped base
 * — no walking in with hundreds of pre-unlocked items from endless grinding.
 *
 * Signed-in users:
 *   - Source of truth is `/api/combine/collection?scope=...` (Postgres).
 *   - On mount, hydrate from the server; also seed any pre-sign-in
 *     localStorage finds into the endless scope so nothing's lost from the
 *     pre-scope era, then clear the local cache. Daily never pulls from the
 *     local cache — it's a fair-start space.
 *   - On new discovery, optimistically add locally and POST to the server
 *     under the current scope.
 *
 * Signed-out users:
 *   - Collection is in-memory only, per scope. It accumulates within the
 *     current session but there's no cross-game persistence until they sign
 *     in. Switching scope resets the in-memory collection for that scope.
 */
export function useCollection(scope: CollectionScope) {
  const { data: session, isPending } = useSession();
  const authed = Boolean(session?.user);
  const [collection, setCollection] = useState<Map<string, number>>(
    () => new Map(),
  );
  const didHydrate = useRef(false);
  const lastAuthed = useRef<boolean | null>(null);
  const lastScope = useRef<CollectionScope | null>(null);
  // Only migrate the pre-scope localStorage cache into the endless scope once
  // per browser lifetime — we don't want to re-migrate on every scope flip.
  const migratedLocal = useRef(false);

  useEffect(() => {
    if (isPending) return;
    if (
      lastAuthed.current === authed &&
      lastScope.current === scope &&
      didHydrate.current
    ) {
      return;
    }
    lastAuthed.current = authed;
    lastScope.current = scope;
    didHydrate.current = true;

    if (!authed) {
      // Signed out: collection is per-scope, in-memory. Clear so endless
      // discoveries don't bleed into a daily session.
      setCollection(new Map());
      return;
    }

    let cancelled = false;
    (async () => {
      // One-time migration: old localStorage finds (pre-scope era) belong in
      // the endless collection. Only run when the active scope is endless so
      // we don't accidentally seed daily.
      if (!migratedLocal.current && scope === "endless") {
        migratedLocal.current = true;
        const local = loadFound();
        if (local.size > 0) {
          try {
            await fetch("/api/combine/collection", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                ids: [...local.keys()],
                scope: "endless",
              }),
            });
          } catch {
            // Non-fatal; next discovery POST retries.
          }
          clearFound();
        }
      }

      try {
        const res = await fetch(
          `/api/combine/collection?scope=${scope}`,
          { credentials: "same-origin" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { found: Record<string, number> };
        if (cancelled) return;
        setCollection(new Map(Object.entries(json.found)));
      } catch {
        // Keep whatever is already in memory.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authed, isPending, scope]);

  const record = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const now = Date.now();
      setCollection((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const id of ids) {
          if (!next.has(id)) {
            next.set(id, now);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      if (authed) {
        void fetch("/api/combine/collection", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids, scope }),
        }).catch(() => {
          // Client state is still consistent; a reload refetches.
        });
      }
    },
    [authed, scope],
  );

  return { collection, authed, isPending, record } as const;
}

/** Backwards-compat side effect for legacy callers that want to mirror
 *  signed-in finds into localStorage (nobody should rely on this now). Kept
 *  so `markFound` still has a home if anything imports it. */
export function markLegacyFound(ids: Iterable<string>): void {
  markFound(ids);
}
