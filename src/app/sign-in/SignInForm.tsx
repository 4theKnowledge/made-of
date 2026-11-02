"use client";

import { useState } from "react";

const isDev = process.env.NODE_ENV !== "production";
const DEV_EMAIL = process.env.NEXT_PUBLIC_DEV_ADMIN_EMAIL ?? "";

export function SignInForm({ inviteRequired }: { inviteRequired: boolean }) {
  const [email, setEmail] = useState("");
  const [invite, setInvite] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  async function devSignIn() {
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/dev/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email || DEV_EMAIL }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      window.location.href = "/account";
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Dev sign-in failed.");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed) {
      setError("Please confirm you are 13 or older.");
      return;
    }
    setStatus("sending");
    setError(null);
    const res = await fetch("/api/sign-in/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        invite: invite || undefined,
        callbackURL: "/account",
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus("error");
      setError(body.error ?? "Something went wrong. Try again.");
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div>
        <h3 style={{ marginTop: 0 }}>Check your email</h3>
        <p>
          We sent a sign-in link to <b>{email}</b>. The link expires in 15
          minutes.
        </p>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Didn&rsquo;t arrive? Check spam, or{" "}
          <button
            type="button"
            onClick={() => setStatus("idle")}
            style={{
              background: "none",
              border: 0,
              color: "inherit",
              textDecoration: "underline",
              cursor: "pointer",
              padding: 0,
              font: "inherit",
            }}
          >
            try again
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <label
        htmlFor="email"
        style={{ fontSize: 13, color: "var(--muted)" }}
      >
        Email
      </label>
      <input
        id="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
        placeholder="you@example.com"
        style={{
          padding: "10px 12px",
          borderRadius: 6,
          border: "1px solid var(--line)",
          background: "var(--bg)",
          color: "var(--ink)",
          font: "inherit",
        }}
      />
      {inviteRequired && (
        <>
          <label
            htmlFor="invite"
            style={{ fontSize: 13, color: "var(--muted)" }}
          >
            Invite code{" "}
            <span style={{ fontSize: 12 }}>
              (new accounts only — leave blank if you already have one)
            </span>
          </label>
          <input
            id="invite"
            type="text"
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="your-code"
            style={{
              padding: "10px 12px",
              borderRadius: 6,
              border: "1px solid var(--line)",
              background: "var(--bg)",
              color: "var(--ink)",
              font: "inherit",
              fontFamily: "var(--mono, ui-monospace, monospace)",
            }}
          />
        </>
      )}
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span style={{ fontSize: 14 }}>
          I confirm I am 13 or older (16+ if in the EU).
        </span>
      </label>
      {error && (
        <p style={{ color: "var(--bad)", fontSize: 13, margin: 0 }}>{error}</p>
      )}
      <button
        type="submit"
        className="btn"
        disabled={status === "sending"}
        style={{ alignSelf: "flex-start" }}
      >
        {status === "sending" ? "Sending…" : "Send sign-in link"}
      </button>
      {isDev && (
        <button
          type="button"
          className="btn"
          onClick={devSignIn}
          disabled={status === "sending" || !(email || DEV_EMAIL)}
          style={{
            alignSelf: "flex-start",
            borderStyle: "dashed",
            opacity: 0.85,
          }}
          title="Dev-only. Skips the email round-trip. Set NEXT_PUBLIC_DEV_ADMIN_EMAIL to pre-fill."
        >
          Dev sign in{email || DEV_EMAIL ? ` (${email || DEV_EMAIL})` : ""}
        </button>
      )}
    </form>
  );
}
