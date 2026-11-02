"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Modal replacement for window.confirm(). Uses the app's cbscrim/cbover
 * styles so it looks like the rest of the dialogs. `destructive` flips the
 * confirm button to the --bad palette for delete flows.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <>
      <div className="cbscrim" onClick={onDismiss} aria-hidden="true" />
      <section
        className="cbover"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 style={{ margin: "4px 0 0 0", fontSize: 18 }}>{title}</h3>
        {body && (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
            {body}
          </p>
        )}
        <div className="row2">
          <button
            ref={cancelRef}
            type="button"
            className="cbh"
            onClick={onDismiss}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="cbh"
            onClick={onConfirm}
            style={
              destructive
                ? {
                    background: "var(--bad)",
                    borderColor: "var(--bad)",
                    color: "var(--bg)",
                  }
                : undefined
            }
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </>,
    document.body,
  );
}
