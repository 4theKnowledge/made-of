"use client";

import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

/**
 * Promise-based wrapper over ConfirmDialog so call sites can keep the
 * inline `if (!(await confirm(...))) return;` shape they had with
 * window.confirm().
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    const p = pendingRef.current;
    if (!p) return;
    setPending(null);
    p.resolve(ok);
  }, []);

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title ?? ""}
      body={pending?.body}
      confirmLabel={pending?.confirmLabel}
      cancelLabel={pending?.cancelLabel}
      destructive={pending?.destructive}
      onConfirm={() => settle(true)}
      onDismiss={() => settle(false)}
    />
  );

  return { confirm, dialog };
}
