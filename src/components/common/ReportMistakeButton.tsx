"use client";

import { useState } from "react";
import { FeedbackSheet } from "./FeedbackSheet";

export function ReportMistakeButton({
  signedIn = false,
  label = "Report a mistake",
  className = "btn primary",
  payload,
}: {
  /** Whether the viewer is signed in. Only affects the "suggest recipe"
   * branch inside the sheet — a plain report submits without auth. Defaults
   * to false so this component can render in static pages that don't read
   * the session. */
  signedIn?: boolean;
  label?: string;
  className?: string;
  /** Optional context passed through to the feedback payload (e.g. itemId,
   * slug, category) so admins can see what the user was looking at. */
  payload?: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        style={{ alignSelf: "flex-start" }}
      >
        {label}
      </button>
      <FeedbackSheet
        open={open}
        onDismiss={() => setOpen(false)}
        signedIn={signedIn}
        initial={{ type: "report", payload }}
      />
    </>
  );
}
