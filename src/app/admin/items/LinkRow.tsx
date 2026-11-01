"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import type { Confidence, Link as LinkRow } from "@/db/schema";

const CONFIDENCES: Confidence[] = ["established", "strong", "debated", "hypothesis"];

export function LinkRow({
  link,
  targetName,
  verb,
}: {
  link: LinkRow;
  targetName: string;
  verb: string;
}) {
  const router = useRouter();
  const [confidence, setConfidence] = useState<Confidence>(link.confidence);
  const [note, setNote] = useState(link.note ?? "");
  const [isCanary, setIsCanary] = useState(link.isCanary);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await fetch(`/api/admin/links/${encodeURIComponent(link.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confidence, note: note || null, isCanary }),
      });
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!window.confirm(`Delete link to ${targetName}?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/links/${encodeURIComponent(link.id)}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)" }}>{verb.toLowerCase()}</span>
        <Link href={`/admin/items/${encodeURIComponent(link.targetItemId)}`}>{targetName}</Link>
        <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 11, color: "var(--muted)" }}>
          {link.type} · {confidence}
          {isCanary ? " · canary" : ""}
        </span>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="btn"
          style={{ marginLeft: "auto", padding: "2px 10px", fontSize: 12 }}
        >
          {editing ? "Close" : "Edit"}
        </button>
      </div>
      {editing && (
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 10px", marginTop: 8, alignItems: "center" }}>
          <label>Confidence</label>
          <select value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence)} style={smallInput}>
            {CONFIDENCES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <label>Note</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} style={smallInput} />
          <label>Canary</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={isCanary} onChange={(e) => setIsCanary(e.target.checked)} />
            <span style={{ color: "var(--muted)", fontSize: 12 }}>Not public</span>
          </label>
          <div />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn primary" disabled={busy} onClick={save} style={{ padding: "2px 10px", fontSize: 12 }}>
              Save
            </button>
            <button type="button" className="btn" disabled={busy} onClick={del} style={{ padding: "2px 10px", fontSize: 12, borderColor: "var(--bad, #a62828)", color: "var(--bad, #a62828)" }}>
              Delete link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const smallInput: React.CSSProperties = {
  padding: "4px 8px",
  border: "1px solid var(--line)",
  borderRadius: 4,
  fontFamily: "inherit",
  fontSize: 13,
  width: "100%",
};
