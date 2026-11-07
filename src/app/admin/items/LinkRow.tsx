"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import type { Confidence, Link as LinkRow } from "@/db/schema";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { pushResponseError, useAdminToast } from "../_toast";

const CONFIDENCES: Confidence[] = ["established", "strong", "debated", "hypothesis"];

export function LinkRow({
  link,
  targetName,
  targetKind,
  verb,
}: {
  link: LinkRow;
  targetName: string;
  targetKind?: string | null;
  verb: string;
}) {
  const router = useRouter();
  const [confidence, setConfidence] = useState<Confidence>(link.confidence);
  const [note, setNote] = useState(link.note ?? "");
  const [isCanary, setIsCanary] = useState(link.isCanary);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { push: toast } = useAdminToast();

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/links/${encodeURIComponent(link.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confidence, note: note || null, isCanary }),
      });
      if (!res.ok) {
        await pushResponseError(toast, res, "Save failed");
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    setConfirmOpen(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/links/${encodeURIComponent(link.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        await pushResponseError(toast, res, "Delete failed");
        return;
      }
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
        {targetKind && (
          <span
            style={{
              fontFamily: "var(--mono, monospace)",
              fontSize: 11,
              color: "var(--muted)",
              padding: "1px 5px",
              border: "1px solid var(--line)",
              borderRadius: 3,
            }}
          >
            {targetKind}
          </span>
        )}
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
            <button type="button" className="btn" disabled={busy} onClick={() => setConfirmOpen(true)} style={{ padding: "2px 10px", fontSize: 12, borderColor: "var(--bad, #a62828)", color: "var(--bad, #a62828)" }}>
              Delete link
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={`Delete link to ${targetName}?`}
        confirmLabel="Delete link"
        destructive
        onConfirm={del}
        onDismiss={() => setConfirmOpen(false)}
      />
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
