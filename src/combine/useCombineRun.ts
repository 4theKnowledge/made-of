/**
 * Client hook owning the server-authoritative Combine run lifecycle
 * (T-0175). Thin shell on top of `fetch` — no engine logic here; the
 * local reducer in `CombineBoard` stays the source of UI truth, and
 * this hook is responsible only for:
 *
 *   - Starting / resuming a run server-side on mount.
 *   - Buffering actions and debounce-flushing them to /checkpoint.
 *   - Reconciling when the server returns 409 (event count drift,
 *     engine-version mismatch, or run-ended). Reconciliation hands
 *     the caller the server's authoritative `state` so the local
 *     reducer can swap to it — see `opts.onReconcile` (T-0181).
 *   - Finishing the run when the engine terminates.
 *
 * Network errors and 404 responses leave `context` null; callers keep
 * their local reducer running until the next successful `start()`.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, GameState } from "./engine";
import type { Mode } from "./types";

type ServerMode = "endless" | "fast" | "daily";

export interface RunContext {
  runId: string;
  seed: number;
  eventCount: number;
  epoch: number;
  /** Server-stamped "player committed to this daily" ISO timestamp
   *  (T-0247). Null for runs the player hasn't tapped Start on yet
   *  (and always null for endless/fast). The start-daily sheet uses
   *  this as the authoritative "has the player committed?" flag — a
   *  reload re-reads it, so the peek-and-reload exploit is closed. */
  startedAt: string | null;
}

export interface StartArgs {
  mode: ServerMode;
  theme: string;
  dailyKey: string | null;
  restart?: boolean;
}

export interface StartResult {
  context: RunContext;
  state: GameState;
  resumed: boolean;
}

/** Fire-and-forget POST wrapper that threads JSON in/out. Returns null
 *  on network error or 404 (route unreachable); throws only on bugs the
 *  caller can't recover from. */
async function postJSON<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    if (res.status === 404) return null; // feature off
    const json = await res.json();
    if (!res.ok) {
      return { __error: true, status: res.status, ...json } as unknown as T;
    }
    return json as T;
  } catch {
    return null;
  }
}

/** Why the server returned 409. The caller treats all four as "drop
 *  local optimistic state and adopt the server's truth" — only the
 *  rendering branch differs (an ended run needs a fresh `start()`,
 *  the others can keep the same run id). */
export type ReconcileReason =
  | "event-count"
  | "engine-version"
  | "run-ended"
  | "run-invalidated";

export interface ReconcileEvent {
  reason: ReconcileReason;
  /** The run id the hook was tracking when the 409 fired. The hook
   *  drops its context synchronously, so a caller that wants to talk
   *  back to the server about this run (e.g. finalizeLegacy on an
   *  engine-version mismatch) needs this out-of-band. */
  runId: string | null;
  /** The server's authoritative state at the moment of the 409.
   *  Null only when the run is no longer active (ended / invalidated)
   *  and the server didn't ship a state body — caller should trigger
   *  a fresh `start()`. */
  state: GameState | null;
  /** Server's event count; null when `state` is null. Callers mirror
   *  this into their run context so the next /checkpoint carries the
   *  correct base. */
  eventCount: number | null;
  epoch: number | null;
}

/** Map a 409 response body to a `ReconcileEvent`. Exported for
 *  testing; the hook calls it inline. The three 409 shapes the server
 *  emits are documented in `src/app/api/combine/runs/[id]/checkpoint/
 *  route.ts`. Anything not recognised falls back to `event-count` —
 *  safer default than throwing, since the caller will still rewind to
 *  the server's event count if one is present. */
export function parseReconcile(body: {
  error?: unknown;
  engineVersionMismatch?: unknown;
  serverEventCount?: unknown;
  state?: unknown;
  epoch?: unknown;
}): ReconcileEvent {
  const errText = typeof body.error === "string" ? body.error : "";
  const isEnded = errText === "run not active";
  const isEngineVer = body.engineVersionMismatch === true;
  const reason: ReconcileReason = isEnded
    ? "run-ended"
    : isEngineVer
      ? "engine-version"
      : "event-count";
  const serverState = (body.state as GameState | undefined) ?? null;
  const serverEventCount =
    typeof body.serverEventCount === "number" ? body.serverEventCount : null;
  const serverEpoch = typeof body.epoch === "number" ? body.epoch : null;
  return {
    reason,
    runId: null,
    state: serverState,
    eventCount: serverEventCount,
    epoch: serverEpoch,
  };
}

export interface UseCombineRunOpts {
  /** Flush debounce (ms). The hook sends buffered actions this long
   *  after the last dispatch. */
  flushMs?: number;
  /** Also flush when the buffer reaches this many events. */
  flushAt?: number;
  /** Fires when the server returned a 409 the hook can't silently
   *  recover from. The caller replaces its local `GameState` with
   *  `event.state` (if non-null) and clears any derived UI state
   *  (fx, toasts, choose dialog) so the swap looks clean. Called
   *  from inside the checkpoint flight — the hook has already
   *  updated its own `context.eventCount`/`epoch` by the time this
   *  fires. Not called for the happy path. */
  onReconcile?: (event: ReconcileEvent) => void;
}

export interface UseCombineRunApi {
  /** True once the hook has either loaded a server run or confirmed
   *  the feature is off. The caller renders the deterministic SSR
   *  state until this flips. */
  ready: boolean;
  /** Server run context if one is active. Null while loading or if
   *  the feature flag is off — in both cases the caller falls back to
   *  its localStorage flow. */
  context: RunContext | null;
  /** True when a server run is owned by this hook. Shortcut for
   *  `context != null`. */
  serverBacked: boolean;
  /** True while a `/finish` request is in flight. Callers gate
   *  post-run UI that depends on the `progress` row being committed
   *  (e.g. daily leaderboard rank lookup) on this flipping back to
   *  false so they don't race the insert. */
  finishing: boolean;
  /** Start (or resume) a run. Returns the server's initial state so
   *  the caller can hydrate its local reducer. */
  start: (args: StartArgs) => Promise<StartResult | null>;
  /** Mark a daily run as "player tapped Start" server-side (T-0247).
   *  Idempotent. Flips `context.startedAt` so the UI gate can close
   *  immediately without another round-trip. Returns the new
   *  `startedAt` or null when server-runs are off / the request
   *  failed. */
  markStartedDaily: () => Promise<string | null>;
  /** Push an action into the checkpoint buffer. The caller has
   *  already applied it to its local state; the buffer is purely for
   *  server validation. */
  push: (action: Action) => void;
  /** Force an immediate flush (e.g. on blur / unmount). */
  flush: () => Promise<void>;
  /** Close the run server-side. Flushes the buffer first, then calls
   *  /finish with any trailing actions. Optionally pass `extras` to
   *  thread extra fields into the finish body (e.g. `durationMs` for
   *  daily timing). */
  finish: (
    trailingActions?: Action[],
    extras?: Record<string, unknown>,
  ) => Promise<GameState | null>;
  /** Register (or replace) the reconcile callback at any point in
   *  render. Useful when the hook has to be called early (e.g. for
   *  `ready`), but the reconcile closure depends on state declared
   *  further down the component. Pass `null` to clear. */
  setOnReconcile: (fn: ((event: ReconcileEvent) => void) | null) => void;
  /** Finalize a stale-engine run using a client-supplied GameState.
   *  Used by the reconcile path when the server returns 409
   *  engineVersionMismatch — we can't replay the stale run, but we
   *  can still bank its score. The server stamps the row with the
   *  stored (old) engine version. Returns true on success. Clears
   *  the run context on success so the caller can start fresh.
   *  See T-0313. */
  finalizeLegacy: (
    runId: string,
    state: GameState,
    extras?: Record<string, unknown>,
  ) => Promise<boolean>;
}

/** Owns a single server run across its lifetime. */
export function useCombineRun(opts: UseCombineRunOpts = {}): UseCombineRunApi {
  const flushMs = opts.flushMs ?? 1500;
  const flushAt = opts.flushAt ?? 8;

  const [ready, setReady] = useState(false);
  const [context, setContext] = useState<RunContext | null>(null);
  const [finishing, setFinishing] = useState(false);
  const bufferRef = useRef<Action[]>([]);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextRef = useRef<RunContext | null>(null);
  contextRef.current = context;
  // Authoritative eventCount for *the next write*. `contextRef.current`
  // is only fresh after a React render — but `flush()` and `finish()`
  // run in the same microtask, so a `setContext(..)` inside flush isn't
  // visible to finish's next line. This ref is updated synchronously
  // every time the server acks a new eventCount (checkpoint happy path
  // or 409 drift reconcile), so `finish()` can read the true base
  // without racing React. See T-0319.
  const latestEcRef = useRef<number | null>(null);
  // Keep the latest onReconcile in a ref so the flush closure doesn't
  // need to be rebuilt every render when the caller passes a fresh
  // function. React-standard "stable callback" pattern.
  const onReconcileRef = useRef<UseCombineRunOpts["onReconcile"]>(undefined);
  onReconcileRef.current = opts.onReconcile;

  const start = useCallback(
    async (args: StartArgs): Promise<StartResult | null> => {
      const res = await postJSON<
        | {
            runId: string;
            seed: number;
            state: GameState;
            eventCount: number;
            epoch: number;
            startedAt: string | null;
            resumed: boolean;
          }
        | { __error: true }
      >("/api/combine/runs/start", args);
      if (!res || "__error" in res) {
        setReady(true);
        setContext(null);
        return null;
      }
      const ctx: RunContext = {
        runId: res.runId,
        seed: res.seed,
        eventCount: res.eventCount,
        epoch: res.epoch,
        startedAt: res.startedAt ?? null,
      };
      setContext(ctx);
      setReady(true);
      bufferRef.current = [];
      latestEcRef.current = ctx.eventCount;
      return { context: ctx, state: res.state, resumed: res.resumed };
    },
    [],
  );

  /** Stamp the current run as "player tapped Start on the daily sheet"
   *  (T-0247). Server-side idempotent; a second call on the same run
   *  is a no-op. Updates `context.startedAt` so downstream UI (gate
   *  effect in `CombineBoard`) sees the flip immediately without
   *  another round-trip. Returns the new `startedAt` or null when
   *  server-runs are off / the request failed. */
  const markStartedDaily = useCallback(async (): Promise<string | null> => {
    const ctx = contextRef.current;
    if (!ctx) return null;
    if (ctx.startedAt) return ctx.startedAt;
    const res = await postJSON<
      { runId: string; startedAt: string | null } | { __error: true }
    >(`/api/combine/runs/${ctx.runId}/start-daily`, {});
    if (!res || "__error" in res) return null;
    const startedAt = res.startedAt ?? null;
    setContext((cur) => (cur ? { ...cur, startedAt } : cur));
    return startedAt;
  }, []);

  // Probe the server on mount with GET /active; readiness flips as soon
  // as we hear back. We don't actually consume the list here — the hook
  // only owns a run once the caller invokes `start`. The probe exists
  // so the UI can distinguish "server reachable, no save" from
  // "haven't talked to the server yet" during first paint.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/combine/runs/active", {
          credentials: "same-origin",
        });
        if (cancelled) return;
        // Response status doesn't matter — the probe is a readiness
        // signal only. Callers must still invoke `start` to own a run
        // (they pass the mode/theme).
        if (!res.ok) {
          setReady(true);
          return;
        }
        // Flag on; `start` will set context when the caller is ready.
        setReady(true);
      } catch {
        if (cancelled) return;
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const flush = useCallback(async () => {
    const ctx = contextRef.current;
    if (!ctx) return;
    if (bufferRef.current.length === 0) return;
    // Serialise flushes — never two in flight at once. If one is
    // already running, the trailing actions queue in the buffer and
    // this call returns; the in-flight flush drains them on its next
    // tick via the post-send re-check.
    if (inFlightRef.current) {
      await inFlightRef.current;
      return;
    }
    const batch = bufferRef.current.slice();
    const sent = batch.length;
    bufferRef.current = [];
    const promise = (async () => {
      const res = await postJSON<
        | {
            eventCount: number;
            epoch: number;
            state: GameState;
          }
        | {
            __error: true;
            status: number;
            error?: string;
            serverEventCount?: number;
            state?: GameState;
            epoch?: number;
            engineVersionMismatch?: boolean;
            // `status` field on the 409 body (distinct from HTTP status)
            // identifies ended/invalidated runs — the server sends
            // `status: 'ended' | 'invalidated'` at runtime even though
            // `postJSON` collides the top-level `status` with the HTTP
            // code. See runStatus below for the runtime-level read.
          }
      >(`/api/combine/runs/${ctx.runId}/checkpoint`, {
        // Use the ref, not ctx.eventCount — if a prior flush in this
        // same tick advanced the server, `ctx.eventCount` is stale.
        baseEventCount: latestEcRef.current ?? ctx.eventCount,
        actions: batch,
      });
      if (!res) {
        // Network error or feature-off. Stash the batch back for a
        // later retry; preserve ordering.
        bufferRef.current = [...batch, ...bufferRef.current];
        return;
      }
      if ("__error" in res) {
        // Server returned a non-2xx. Reconcile on 409 (drift / engine
        // version / ended run); drop silently on anything else so a
        // single bad batch doesn't tombstone the run. See
        // `parseReconcile` for the wire-shape mapping.
        if (res.status === 409) {
          const event = parseReconcile(res);
          event.runId = ctx.runId;
          // For ended/invalidated runs, drop the context so the caller
          // can `start()` a fresh one. Engine-version mismatches are
          // unrecoverable on the existing run id — the server will 409
          // every subsequent write — so treat them the same way: drop
          // the context and let the caller mint a new run. The
          // event-count-drift case keeps the run id and just rewinds
          // our local count to the server's truth.
          if (event.reason === "run-ended" || event.reason === "engine-version") {
            setContext(null);
            latestEcRef.current = null;
          } else if (event.eventCount !== null) {
            latestEcRef.current = event.eventCount;
            setContext((cur) =>
              cur
                ? {
                    ...cur,
                    eventCount: event.eventCount!,
                    epoch: event.epoch ?? cur.epoch,
                  }
                : cur,
            );
          }
          onReconcileRef.current?.(event);
        }
        return;
      }
      latestEcRef.current = res.eventCount;
      setContext((cur) =>
        cur ? { ...cur, eventCount: res.eventCount, epoch: res.epoch } : cur,
      );
    })();
    inFlightRef.current = promise.finally(() => {
      inFlightRef.current = null;
    });
    await inFlightRef.current;
    // If more actions landed during the flight, kick a tail flush so
    // the buffer doesn't stall waiting for the next idle debounce.
    if (bufferRef.current.length > 0) {
      // Fire-and-forget; the next scheduled flush or an explicit call
      // will pick it up.
      void flush();
    }
    // Suppress "sent" unused-var warning — kept for future logging.
    void sent;
  }, []);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, flushMs);
  }, [flush, flushMs]);

  const push = useCallback(
    (action: Action) => {
      if (!contextRef.current) return;
      bufferRef.current.push(action);
      if (bufferRef.current.length >= flushAt) {
        void flush();
      } else {
        scheduleFlush();
      }
    },
    [flush, scheduleFlush, flushAt],
  );

  const finish = useCallback(
    async (
      trailing: Action[] = [],
      extras: Record<string, unknown> = {},
    ): Promise<GameState | null> => {
      const ctx = contextRef.current;
      if (!ctx) return null;
      setFinishing(true);
      try {
        // Drain any pending flush first so the server sees everything
        // in order.
        await flush();
        const pending = [...bufferRef.current, ...trailing];
        bufferRef.current = [];
        // `latestEcRef` is updated synchronously by flush() when the
        // server acks a new eventCount, so it stays accurate even when
        // React hasn't re-rendered yet (and thus `contextRef.current`
        // still points at the pre-flush state). Without this,
        // every daily completion whose terminal action lands in the
        // flush just before /finish would 409 on event-count mismatch
        // with no rescue, because stored.over was still false. T-0319.
        const base =
          latestEcRef.current ??
          contextRef.current?.eventCount ??
          ctx.eventCount;
        const res = await postJSON<
          | { state: GameState; eventCount: number; ended: boolean }
          | {
              __error: true;
              status: number;
              engineVersionMismatch?: boolean;
              serverEventCount?: number;
              state?: GameState;
              epoch?: number;
              error?: string;
            }
        >(`/api/combine/runs/${ctx.runId}/finish`, {
          baseEventCount: base,
          actions: pending,
          ...extras,
        });
        if (!res) return null;
        if ("__error" in res) {
          // 409 from /finish is the mid-run engine bump case (or a
          // concurrent end). Mirror the checkpoint reconcile path so
          // the caller can decide whether to finalize-legacy. Drop the
          // context on 409 since no further writes against this run id
          // will succeed.
          if (res.status === 409) {
            const event = parseReconcile(res);
            event.runId = ctx.runId;
            setContext(null);
            latestEcRef.current = null;
            onReconcileRef.current?.(event);
          }
          return null;
        }
        // Clear the context — a finished run isn't ours to checkpoint anymore.
        setContext(null);
        latestEcRef.current = null;
        return res.state;
      } finally {
        setFinishing(false);
      }
    },
    [flush],
  );

  // Flush on tab-hide / page-unload. Best-effort — browsers kill
  // in-flight fetches on unload, but Chrome keeps same-origin keepalive
  // POSTs alive. We use a plain fetch; the hook's postJSON wrapper
  // isn't suitable here because we can't await on unload.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onBeforeUnload = () => {
      const ctx = contextRef.current;
      if (!ctx || bufferRef.current.length === 0) return;
      try {
        const payload = JSON.stringify({
          baseEventCount: ctx.eventCount,
          actions: bufferRef.current,
        });
        navigator.sendBeacon?.(
          `/api/combine/runs/${ctx.runId}/checkpoint`,
          new Blob([payload], { type: "application/json" }),
        );
        bufferRef.current = [];
      } catch {
        // ignore
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flush]);

  const setOnReconcile = useCallback(
    (fn: ((event: ReconcileEvent) => void) | null) => {
      onReconcileRef.current = fn ?? undefined;
    },
    [],
  );

  const finalizeLegacy = useCallback(
    async (
      runId: string,
      state: GameState,
      extras: Record<string, unknown> = {},
    ): Promise<boolean> => {
      // Caller passes the runId explicitly because the hook has
      // usually already dropped its context by the time reconcile
      // fires — contextRef.current is null here.
      const res = await postJSON<
        | { finalized: true; progressWritten: boolean; engineVersion: number }
        | { __error: true }
      >(`/api/combine/runs/${runId}/finalize-legacy`, {
        state,
        ...extras,
      });
      // Nothing to clean up on the hook — the context is already null
      // by the time this runs. Return true on any 2xx; the server owns
      // idempotency on the row itself.
      return !!res && !("__error" in res);
    },
    [],
  );

  return {
    ready,
    context,
    serverBacked: context != null,
    finishing,
    start,
    markStartedDaily,
    push,
    flush,
    finish,
    setOnReconcile,
    finalizeLegacy,
  };
}

// Suppress unused-import TS warnings in files that re-export Mode via
// this module's type surface area.
export type { Mode };
