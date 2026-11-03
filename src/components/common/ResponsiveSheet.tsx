"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * A modal that renders as a centred dialog on wide screens and a
 * bottom sheet on phones (≤600px). Portal-rendered to document.body
 * so it escapes any transformed or contained ancestor — mirrors the
 * pattern in src/app/admin/tree/TreeList.tsx (RowActionSheet).
 *
 * Styles live in globals.css under .rsheet-*.
 */
export function ResponsiveSheet({
  open,
  onDismiss,
  ariaLabel,
  className,
  children,
}: {
  open: boolean;
  onDismiss: () => void;
  ariaLabel: string;
  /** Extra class on the inner surface for per-dialog tweaks. */
  className?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="rsheet-scrim" onClick={onDismiss} aria-hidden="true" />
      <section
        role="dialog"
        aria-label={ariaLabel}
        aria-modal="true"
        className={`rsheet${className ? ` ${className}` : ""}`}
      >
        {children}
      </section>
    </>,
    document.body,
  );
}
