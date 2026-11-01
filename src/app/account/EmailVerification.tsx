"use client";

import { useState } from "react";
import { signIn } from "@/lib/auth-client";

export function EmailVerification({
  email,
  verified,
}: {
  email: string;
  verified: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  if (verified) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Badge tone="good" label="Verified" />
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          Signing in with your email counts as verification.
        </span>
      </div>
    );
  }

  async function resend() {
    setStatus("sending");
    setError(null);
    const { error: err } = await signIn.magicLink({
      email,
      callbackURL: "/account",
    });
    if (err) {
      setStatus("error");
      setError(err.message ?? "Something went wrong. Try again.");
      return;
    }
    setStatus("sent");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Badge tone="warn" label="Not verified" />
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          Click the link in your sign-in email to verify.
        </span>
      </div>
      {status === "sent" ? (
        <p style={{ fontSize: 13, margin: 0 }}>
          Sent a new link to <b>{email}</b>. Check your inbox.
        </p>
      ) : (
        <button
          type="button"
          className="btn"
          onClick={resend}
          disabled={status === "sending"}
        >
          {status === "sending" ? "Sending…" : "Resend verification email"}
        </button>
      )}
      {error && (
        <p style={{ color: "var(--bad)", fontSize: 13, margin: 0 }}>{error}</p>
      )}
    </div>
  );
}

function Badge({ tone, label }: { tone: "good" | "warn"; label: string }) {
  const colours = tone === "good"
    ? { bg: "#DFF3D4", fg: "#1F5B10", border: "#8EC37A" }
    : { bg: "#FBE8C6", fg: "#6B4A0F", border: "#D9B266" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: colours.bg,
        color: colours.fg,
        border: `1px solid ${colours.border}`,
        font: "inherit",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: colours.fg,
        }}
      />
      {label}
    </span>
  );
}
