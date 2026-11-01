"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { ItemKind, Tier } from "@/db/schema";
import { TIER } from "@/lib/taxonomy";

const KINDS: ItemKind[] = [
  "cosmic", "element", "mineral", "living", "substance", "food",
  "energy", "part", "object", "tool", "place", "information",
];

export function NewItemForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>("M");
  const [kind, setKind] = useState<ItemKind>("object");
  const [firstAppeared, setFirstAppeared] = useState("");
  const [symbol, setSymbol] = useState("");
  const [fact, setFact] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          tier,
          kind,
          firstAppeared: firstAppeared || null,
          symbol: symbol || null,
          fact,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        setErr(body.error ?? `Failed: ${res.status}`);
        return;
      }
      router.push(`/admin/items/${encodeURIComponent(body.id)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "10px 16px", alignItems: "center" }}>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required style={inputStyle} />
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
          placeholder="13.8bya · 1994 · -3500"
          style={inputStyle}
        />
        <label>Symbol</label>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} style={inputStyle} />
        <label>Fact</label>
        <textarea value={fact} onChange={(e) => setFact(e.target.value)} rows={3} style={{ ...inputStyle, fontFamily: "inherit" }} />
      </div>
      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        <button type="submit" disabled={busy} className="btn primary">
          {busy ? "Creating…" : "Create draft"}
        </button>
      </div>
      {err && <p style={{ color: "var(--bad, #a62828)", marginTop: 10 }}>{err}</p>}
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
