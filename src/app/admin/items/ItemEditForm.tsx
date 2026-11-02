"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Item, ItemKind, ItemStatus, Tier } from "@/db/schema";
import { TIER } from "@/lib/taxonomy";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

const KINDS: ItemKind[] = [
  "cosmic", "element", "mineral", "living", "substance", "food",
  "energy", "part", "object", "tool", "place", "information",
];
const STATUSES: ItemStatus[] = ["draft", "review", "live"];

export function ItemEditForm({ item }: { item: Item }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState(item.name);
  const [tier, setTier] = useState<Tier>(item.tier);
  const [kind, setKind] = useState<ItemKind>(item.kind);
  const [firstAppeared, setFirstAppeared] = useState(item.firstAppeared ?? "");
  const [symbol, setSymbol] = useState(item.symbol ?? "");
  const [fact, setFact] = useState(item.fact);
  const [tagsText, setTagsText] = useState(item.tags.join(", "));
  const [status, setStatus] = useState<ItemStatus>(item.status);
  const [isCanary, setIsCanary] = useState(item.isCanary);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          tier,
          kind,
          firstAppeared: firstAppeared || null,
          symbol: symbol || null,
          fact,
          tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
          status,
          isCanary,
        }),
      });
      if (!res.ok) {
        setErr(`Save failed: ${res.status}`);
      } else {
        setMsg("Saved.");
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function onPublish() {
    setPublishing(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/items/${encodeURIComponent(item.id)}/publish`, { method: "POST" });
      if (!res.ok) {
        setErr(`Publish failed: ${res.status}`);
      } else {
        setStatus("live");
        setMsg("Published. Snapshot reloaded.");
        router.refresh();
      }
    } finally {
      setPublishing(false);
    }
  }

  async function onUnpublish() {
    setPublishing(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/items/${encodeURIComponent(item.id)}/unpublish`, { method: "POST" });
      if (!res.ok) {
        setErr(`Unpublish failed: ${res.status}`);
      } else {
        setStatus("draft");
        setMsg("Unpublished.");
        router.refresh();
      }
    } finally {
      setPublishing(false);
    }
  }

  async function onDelete() {
    setConfirmOpen(false);
    setDeleting(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        setErr(body.message ?? body.error ?? `Delete failed: ${res.status}`);
      } else {
        window.location.href = "/admin/items";
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={onSave}>
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "10px 16px", alignItems: "center" }}>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />

        <label>Tier</label>
        <select value={tier} onChange={(e) => setTier(e.target.value as Tier)} style={inputStyle}>
          {Object.entries(TIER).map(([k, v]) => (
            <option key={k} value={k}>{v.name}</option>
          ))}
        </select>

        <label>Kind</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as ItemKind)} style={inputStyle}>
          {KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>

        <label>First appeared</label>
        <input
          value={firstAppeared}
          onChange={(e) => setFirstAppeared(e.target.value)}
          placeholder="13.8bya · 385mya · 10ka · 1994 · -3500"
          style={inputStyle}
        />

        <label>Symbol</label>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} style={inputStyle} />

        <label>Fact</label>
        <textarea value={fact} onChange={(e) => setFact(e.target.value)} rows={3} style={{ ...inputStyle, fontFamily: "inherit" }} />

        <label>Tags</label>
        <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="comma, separated" style={inputStyle} />

        <label>Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)} style={inputStyle}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <label>Canary</label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={isCanary} onChange={(e) => setIsCanary(e.target.checked)} />
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Flag this item as a canary (not public).</span>
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
        <button type="submit" disabled={saving} className="btn primary">
          {saving ? "Saving…" : "Save"}
        </button>
        {status === "live" ? (
          <button type="button" onClick={onUnpublish} disabled={publishing} className="btn">
            {publishing ? "…" : "Unpublish"}
          </button>
        ) : (
          <button type="button" onClick={onPublish} disabled={publishing} className="btn">
            {publishing ? "…" : "Publish"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
          className="btn"
          style={{ marginLeft: "auto", borderColor: "var(--bad, #a62828)", color: "var(--bad, #a62828)" }}
        >
          {deleting ? "…" : "Delete"}
        </button>
      </div>
      {msg && <p style={{ color: "var(--good, #2a7a2a)", marginTop: 10 }}>{msg}</p>}
      {err && <p style={{ color: "var(--bad, #a62828)", marginTop: 10 }}>{err}</p>}
      <ConfirmDialog
        open={confirmOpen}
        title={`Delete "${item.name}"?`}
        body="This is irreversible."
        confirmLabel="Delete"
        destructive
        onConfirm={onDelete}
        onDismiss={() => setConfirmOpen(false)}
      />
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--line)",
  borderRadius: 4,
  fontFamily: "inherit",
  fontSize: 14,
  width: "100%",
};
