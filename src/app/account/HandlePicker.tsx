"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  initialHandle: string | null;
  locked: boolean;
};

export function HandlePicker({ initialHandle, locked: initialLocked }: Props) {
  const router = useRouter();
  const [handle, setHandle] = useState(initialHandle);
  const [locked, setLocked] = useState(initialLocked);
  const [busy, setBusy] = useState<"reroll" | "keep" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reroll() {
    setBusy("reroll");
    setError(null);
    try {
      const res = await fetch("/api/account/handle", { method: "PATCH" });
      const data = (await res.json()) as { handle?: string; error?: string };
      if (!res.ok || !data.handle) {
        setError(data.error ?? "Could not reroll");
        return;
      }
      setHandle(data.handle);
    } finally {
      setBusy(null);
    }
  }

  async function keep() {
    if (!handle) return;
    setBusy("keep");
    setError(null);
    try {
      const res = await fetch("/api/account/handle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not save");
        return;
      }
      setLocked(true);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (locked) {
    return (
      <div>
        <code style={{ fontSize: 15 }}>{handle}</code>
        <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0 0" }}>
          Names are permanent — this one is yours.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
      <code style={{ fontSize: 18 }}>{handle ?? "—"}</code>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          onClick={keep}
          disabled={busy !== null || !handle}
        >
          {busy === "keep" ? "Saving…" : "Keep this name"}
        </button>
        <button
          type="button"
          onClick={reroll}
          disabled={busy !== null}
          style={{
            background: "none",
            border: "1px solid var(--line)",
            color: "var(--ink)",
            padding: "8px 14px",
            borderRadius: 6,
            cursor: "pointer",
            font: "inherit",
          }}
        >
          {busy === "reroll" ? "Rolling…" : "Try another"}
        </button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
        Pick carefully — names can&rsquo;t be changed once saved.
      </p>
      {error && (
        <p style={{ color: "var(--bad)", fontSize: 13, margin: 0 }}>{error}</p>
      )}
    </div>
  );
}
