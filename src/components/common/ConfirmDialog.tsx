"use client";

import { useEffect, useRef } from "react";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";
import { ButtonGroup } from "@/components/common/ButtonGroup";

/**
 * Modal replacement for window.confirm(). Uses the shared ResponsiveSheet
 * so it's a centred modal on wide screens and a bottom sheet on phones.
 * `destructive` flips the confirm button to the --bad palette for delete
 * flows.
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
  }, [open]);

  return (
    <ResponsiveSheet open={open} onDismiss={onDismiss} ariaLabel={title}>
      <h3 style={{ margin: "4px 0 0 0", fontSize: 18 }}>{title}</h3>
      {body && (
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
          {body}
        </p>
      )}
      <ButtonGroup>
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
      </ButtonGroup>
    </ResponsiveSheet>
  );
}
