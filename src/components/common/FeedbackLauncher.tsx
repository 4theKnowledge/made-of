"use client";

import { useState } from "react";
import { FeedbackSheet } from "./FeedbackSheet";

/** Footer button that opens the global feedback sheet. */
export function FeedbackLauncher({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="footLink"
        style={{
          background: "none",
          border: 0,
          padding: 0,
          font: "inherit",
          color: "inherit",
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        Feedback
      </button>
      <FeedbackSheet open={open} onDismiss={() => setOpen(false)} signedIn={signedIn} />
    </>
  );
}
