/**
 * Client hook owning the server-authoritative Combine run lifecycle
 * (T-0175). Thin shell on top of `fetch` — no engine logic here; the
 * local reducer in `CombineBoard` stays the source of UI truth, and
 * this hook is responsible only for:
 *
 *   - Starting / resuming a run server-side on mount.
 *   - Buffering actions and debounce-flushing them to /checkpoint.
 *   - Reconciling when the server returns 409 (event count drift).
 *   - Finishing the run when the engine terminates.
 *
 * The hook is a no-op when `COMBINE_SERVER_RUNS` is off (the start
 * route returns 404). Callers treat that as "server not available,
 * stay on localStorage" without branching on the env.
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
 *  on network error or 404 (feature flag off); throws only on bugs the
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

export interface UseCombineRunOpts {
  /** Flush debounce (ms). The hook sends buffered actions this long
   *  after the last dispatch. */
  flushMs?: number;
  /** Also flush when the buffer reaches this many events. */
  flushAt?: number;
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
  /** Start (or resume) a run. Returns the server's initial state so
   *  the caller can hydrate its local reducer. */
  start: (args: StartArgs) => Promise<StartResult | null>;
  /** Push an action into the checkpoint buffer. The caller has
   *  already applied it to its local state; the buffer is purely for
   *  server validation. */
  push: (action: Action) => void;
  /** Force an immediate flush (e.g. on blur / unmount). */
  flush: () => Promise<void>;
  /** Close the run server-side. Flushes the buffer first, then calls
   *  /finish with any trailing actions. */
  finish: (trailingActions?: Action[]) => Promise<GameState | null>;
}

/** Owns a single server run across its lifetime. */
export function useCombineRun(opts: UseCombineRunOpts = {}): UseCombineRunApi {
  const flushMs = opts.flushMs ?? 1500;
  const flushAt = opts.flushAt ?? 8;

  const [ready, setReady] = useState(false);
  const [context, setContext] = useState<RunContext | null>(null);
  const bufferRef = useRef<Action[]>([]);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextRef = useRef<RunContext | null>(null);
  contextRef.current = context;

  const start = useCallback(
    async (args: StartArgs): Promise<StartResult | null> => {
      const res = await postJSON<
        | {
            runId: string;
            seed: number;
            state: GameState;
            eventCount: number;
            epoch: number;
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
      };
      setContext(ctx);
      setReady(true);
      bufferRef.current = [];
      return { context: ctx, state: res.state, resumed: res.resumed };
    },
    [],
  );

  // Mark ready when the feature flag is off. We detect that with a
  // GET /active probe on mount — a 200 with `{ runs: [] }` while the
  // caller hasn't called `start` means we're on a server that's live.
  // A 404 means the flag is off; either way we flip ready so the UI
  // can proceed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/combine/runs/active", {
          credentials: "same-origin",
        });
        if (cancelled) return;
        // 404 = flag off; 200 = flag on but we only use this probe as
        // a readiness signal — callers must still invoke `start` to
        // own a run (they pass the mode/theme).
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
            serverEventCount?: number;
            state?: GameState;
            epoch?: number;
          }
      >(`/api/combine/runs/${ctx.runId}/checkpoint`, {
        baseEventCount: ctx.eventCount,
        actions: batch,
      });
      if (!res) {
        // Network error or feature-off. Stash the batch back for a
        // later retry; preserve ordering.
        bufferRef.current = [...batch, ...bufferRef.current];
        return;
      }
      if ("__error" in res) {
        // 409 → server has newer truth; the caller hasn't wired full
        // reconciliation yet, but the epoch + state are available for
        // a future iteration. For now, drop the batch to avoid a
        // retry storm and let the next start() pull fresh state.
        if (res.status === 409 && typeof res.serverEventCount === "number") {
          setContext((cur) =>
            cur ? { ...cur, eventCount: res.serverEventCount!, epoch: res.epoch ?? cur.epoch } : cur,
          );
        }
        return;
      }
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
    async (trailing: Action[] = []): Promise<GameState | null> => {
      const ctx = contextRef.current;
      if (!ctx) return null;
      // Drain any pending flush first so the server sees everything
      // in order.
      await flush();
      const pending = [...bufferRef.current, ...trailing];
      bufferRef.current = [];
      const base = contextRef.current?.eventCount ?? ctx.eventCount;
      const res = await postJSON<
        | { state: GameState; eventCount: number; ended: boolean }
        | { __error: true }
      >(`/api/combine/runs/${ctx.runId}/finish`, {
        baseEventCount: base,
        actions: pending,
      });
      if (!res || "__error" in res) return null;
      // Clear the context — a finished run isn't ours to checkpoint anymore.
      setContext(null);
      return res.state;
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

  return {
    ready,
    context,
    serverBacked: context != null,
    start,
    push,
    flush,
    finish,
  };
}

// Suppress unused-import TS warnings in files that re-export Mode via
// this module's type surface area.
export type { Mode };
