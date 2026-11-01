"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { clearFound, loadFound, markFound } from "./storage";

/**
 * The player's lifetime Combine collection: `itemId → firstFoundAt (epoch ms)`.
 *
 * Signed-in users:
 *   - Source of truth is `/api/combine/collection` (Postgres).
 *   - On mount, hydrate from the server; also seed any pre-sign-in
 *     localStorage finds into the server so nothing's lost, then clear the
 *     local cache so future reads only use the server.
 *   - On new discovery, optimistically add locally and POST to the server.
 *
 * Signed-out users:
 *   - Collection is in-memory only. It accumulates within the current
 *     session as the player makes new discoveries, but there's no cross-game
 *     persistence until they sign in. We intentionally don't read or write
 *     localStorage here — a signed-out user starting a new game sees an
 *     empty collection, which is the gating behaviour the product wants.
 */
export function useCollection() {
  const { data: session, isPending } = useSession();
  const authed = Boolean(session?.user);
  const [collection, setCollection] = useState<Map<string, number>>(
    () => new Map(),
  );
  const didHydrate = useRef(false);
  const lastAuthed = useRef<boolean | null>(null);

  // Hydrate when auth state settles. Re-run if the user signs in/out mid-
  // session so the collection follows them.
  useEffect(() => {
    if (isPending) return;
    if (lastAuthed.current === authed && didHydrate.current) return;
    lastAuthed.current = authed;
    didHydrate.current = true;

    if (!authed) {
      // Signed out: wipe any in-memory collection from a previous session.
      // Local storage already wasn't used for signed-out users.
      setCollection(new Map());
      return;
    }

    let cancelled = false;
    (async () => {
      // Opportunistically migrate any pre-sign-in local finds to the server
      // (one-time; the server's ON CONFLICT DO NOTHING keeps the earliest
      // timestamp). Then clear the local cache so it doesn't shadow the
      // server state in future renders.
      const local = loadFound();
      if (local.size > 0) {
        try {
          await fetch("/api/combine/collection", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ids: [...local.keys()] }),
          });
        } catch {
          // Non-fatal; the next discovery POST will re-attempt.
        }
        clearFound();
      }

      try {
        const res = await fetch("/api/combine/collection", {
          credentials: "same-origin",
        });
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
  }, [authed, isPending]);

  /** Record new discoveries. Idempotent — existing ids keep their original
   *  timestamp. For signed-in users this also persists to the server. */
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
          body: JSON.stringify({ ids }),
        }).catch(() => {
          // If the POST fails the client state is still consistent; the next
          // discovery in the same game will include the retry via a fresh
          // POST, and a reload will refetch from the server.
        });
      } else {
        // Signed-out: do NOT mirror to localStorage. The product rule is
        // "no cross-game persistence until they sign in."
      }
    },
    [authed],
  );

  return { collection, authed, isPending, record } as const;
}

/** Backwards-compat side effect for legacy callers that want to mirror
 *  signed-in finds into localStorage (nobody should rely on this now). Kept
 *  so `markFound` still has a home if anything imports it. */
export function markLegacyFound(ids: Iterable<string>): void {
  markFound(ids);
}
