"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export function AccountActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<"out" | "del" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function doSignOut() {
    setBusy("out");
    await signOut();
    router.push("/");
    router.refresh();
  }

  async function doDelete() {
    if (
      !window.confirm(
        "Delete your account? This removes your email and sign-in records. This can't be undone.",
      )
    )
      return;
    setBusy("del");
    setError(null);
    const res = await fetch("/api/account", { method: "DELETE" });
    if (!res.ok) {
      setBusy(null);
      setError("Could not delete account. Try again later.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      <button
        type="button"
        className="btn"
        onClick={doSignOut}
        disabled={busy !== null}
      >
        {busy === "out" ? "Signing out…" : "Sign out"}
      </button>
      <button
        type="button"
        onClick={doDelete}
        disabled={busy !== null}
        style={{
          background: "none",
          border: "1px solid var(--line)",
          color: "var(--bad)",
          padding: "8px 14px",
          borderRadius: 6,
          cursor: "pointer",
          font: "inherit",
        }}
      >
        {busy === "del" ? "Deleting…" : "Delete account"}
      </button>
      {error && (
        <p style={{ color: "var(--bad)", fontSize: 13, margin: 0 }}>{error}</p>
      )}
    </div>
  );
}
