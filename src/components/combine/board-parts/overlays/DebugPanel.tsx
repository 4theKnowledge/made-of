"use client";

import React from "react";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";

/** Admin-only debug panel. Scaffold for future runtime experiments
 *  (feature-flagged mechanic tweaks, dealer parameter overrides, etc).
 *  Empty today — the previous playtest mode/tray toggles were retired
 *  once soft bands became the sole progression mechanic. Rendering is
 *  gated on `isAdmin` in the TopBar/CombineBoard. */
export function DebugPanel({ onDismiss }: { onDismiss: () => void }) {
  return (
    <ResponsiveSheet
      open
      onDismiss={onDismiss}
      ariaLabel="Debug panel"
      className="cbsoundm"
    >
      <span className="k">Debug</span>
      <h3>No experiments active</h3>
      <p>
        This panel is a scaffold for admin-only runtime toggles. When an
        experiment ships, controls appear here.
      </p>
      <button type="button" className="cbh cbback" onClick={onDismiss}>
        Done
      </button>
    </ResponsiveSheet>
  );
}
