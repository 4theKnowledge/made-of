"use client";

/**
 * Admin-wide toast. Mounted once in `src/app/admin/layout.tsx`; every
 * admin surface (tree, per-item page, bulk upload, future routes) calls
 * `useAdminToast()` to surface errors and infos through the same widget.
 *
 * Shape and styling is lifted from the original TreeList toast so the
 * tree stays visually identical. Multi-line messages (invariant-audit
 * failures) get a mono font and a longer hold so the offender list is
 * actually readable.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastKind = "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastContextValue {
  push: (text: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useAdminToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Safe fallback for stories or stray mounts outside the admin layout —
    // prefer a silent no-op over crashing the page.
    return { push: () => {} };
  }
  return ctx;
}

export function AdminToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((text: string, kind: ToastKind = "error") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    // Multi-line messages (invariant-violation reports) deserve more time
    // to read. Everything else sticks to the standard 5s.
    const ttl = text.includes("\n") ? 20000 : 5000;
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);

  const dismiss = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    [],
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <Toasts list={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function Toasts({
  list,
  dismiss,
}: {
  list: Toast[];
  dismiss: (id: number) => void;
}) {
  if (!list.length) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 100,
      }}
    >
      {list.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          style={{
            background: t.kind === "error" ? "#f85149" : "var(--surface)",
            color: t.kind === "error" ? "#fff" : "var(--ink)",
            border: "1.5px solid var(--ink)",
            borderRadius: 3,
            boxShadow: "2px 2px 0 var(--ink)",
            padding: "8px 12px",
            fontSize: 13,
            cursor: "pointer",
            maxWidth: 420,
            whiteSpace: "pre-wrap",
            fontFamily: t.text.includes("\n")
              ? "var(--font-mono, monospace)"
              : undefined,
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

/**
 * Convenience: read a `Response` and push the best available error
 * message onto the toast. 422 bodies carry the audit-friendly
 * `message` field; everything else falls back to `error` or the
 * status code.
 */
export async function pushResponseError(
  push: ToastContextValue["push"],
  res: Response,
  fallbackPrefix = "Request failed",
): Promise<void> {
  let msg = `${fallbackPrefix}: ${res.status}`;
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    if (res.status === 422 && body.message) {
      msg = body.message;
    } else if (body.error) {
      msg = `${fallbackPrefix}: ${body.error}`;
    }
  } catch {
    // keep the status fallback
  }
  push(msg, "error");
}
