"use client";

import { useState } from "react";
import { signIn } from "@/lib/auth-client";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed) {
      setError("Please confirm you are 13 or older.");
      return;
    }
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
    </form>
  );
}
