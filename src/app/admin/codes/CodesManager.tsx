"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CodeRow {
  code: string;
  kind: "invite" | "promo";
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
  redemptions: number;
}

export function CodesManager({ initial }: { initial: CodeRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<CodeRow[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mint form
  const [count, setCount] = useState(5);
  const [kind, setKind] = useState<"invite" | "promo">("invite");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [explicit, setExplicit] = useState("");

  async function mint(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: explicit || undefined,
          kind,
          maxUses: maxUses === "" ? null : Number(maxUses),
          expiresAt: expiresAt || null,
          note: note || null,
          count: explicit ? 1 : count,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        codes: Array<Omit<CodeRow, "redemptions">>;
      };
      setRows((prev) => [
        ...data.codes.map((c) => ({
          ...c,
          expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString() : null,
          createdAt: new Date(c.createdAt).toISOString(),
          redemptions: 0,
        })),
        ...prev,
      ]);
      setExplicit("");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mint codes.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(code: string) {
    if (!confirm(`Delete code "${code}"? Any redemption rows will also go.`))
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/codes/${encodeURIComponent(code)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setRows((prev) => prev.filter((r) => r.code !== code));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard denied — not worth a toast system, just fall through.
    }
  }

  async function copyAllNew(count = 10) {
    const picks = rows
      .filter((r) => r.uses === 0 && (r.maxUses == null || r.maxUses > 0))
      .slice(0, count);
    await copy(picks.map((p) => p.code).join("\n"));
  }

  return (
    <>
      <h3 style={{ marginTop: 0 }}>Mint codes</h3>
      <form
        onSubmit={mint}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          alignItems: "end",
          marginBottom: 20,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "invite" | "promo")}
            style={fieldStyle}
          >
            <option value="invite">invite</option>
            <option value="promo">promo</option>
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Count</span>
          <input
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            disabled={Boolean(explicit)}
            style={fieldStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Max uses (blank = unlimited)
          </span>
          <input
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            style={fieldStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Expires (optional)
          </span>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            style={fieldStyle}
          />
        </label>
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            gridColumn: "1 / -1",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Note (optional, admin-only)
          </span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. launch batch for alex"
            style={fieldStyle}
          />
        </label>
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            gridColumn: "1 / -1",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Explicit code (optional — leave blank to auto-mint)
          </span>
          <input
            type="text"
            value={explicit}
            onChange={(e) => setExplicit(e.target.value)}
            placeholder="e.g. launch-week"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            style={{ ...fieldStyle, fontFamily: "var(--mono, monospace)" }}
          />
        </label>
        {error && (
          <p
            style={{
              gridColumn: "1 / -1",
              color: "var(--bad)",
              fontSize: 13,
              margin: 0,
            }}
          >
            {error}
          </p>
        )}
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Working…" : "Mint"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => copyAllNew(count)}
            disabled={busy || rows.length === 0}
            style={{ borderStyle: "dashed" }}
            title="Copy the newest unused codes to the clipboard"
          >
            Copy unused
          </button>
        </div>
      </form>

      <h3 style={{ marginTop: 0 }}>Existing codes ({rows.length})</h3>
      {rows.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>None yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={th}>Code</th>
                <th style={th}>Kind</th>
                <th style={th}>Uses</th>
                <th style={th}>Expires</th>
                <th style={th}>Note</th>
                <th style={th}>Created</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const spent =
                  r.maxUses != null && r.uses >= r.maxUses;
                const expired =
                  r.expiresAt && new Date(r.expiresAt).getTime() < Date.now();
                return (
                  <tr key={r.code} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ ...td, fontFamily: "var(--mono, monospace)" }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => copy(r.code)}
                        title="Copy to clipboard"
                        style={{
                          padding: "2px 8px",
                          fontSize: 13,
                          borderStyle: "dashed",
                          background: "transparent",
                          fontFamily: "var(--mono, monospace)",
                          opacity: spent || expired ? 0.55 : 1,
                        }}
                      >
                        {r.code}
                      </button>
                    </td>
                    <td style={td}>{r.kind}</td>
                    <td style={td}>
                      {r.uses}
                      {r.maxUses != null ? ` / ${r.maxUses}` : " / ∞"}
                      {spent && (
                        <span style={{ color: "var(--muted)" }}> (spent)</span>
                      )}
                    </td>
                    <td style={td}>
                      {r.expiresAt ? (
                        <>
                          {new Date(r.expiresAt).toLocaleDateString()}
                          {expired && (
                            <span style={{ color: "var(--muted)" }}>
                              {" "}
                              (expired)
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={td}>
                      {r.note ?? (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={td}>
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={() => remove(r.code)}
                        disabled={busy}
                        style={{
                          background: "none",
                          border: 0,
                          color: "var(--bad)",
                          cursor: "pointer",
                          padding: 0,
                          font: "inherit",
                          textDecoration: "underline",
                        }}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const fieldStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--line)",
  background: "var(--bg)",
  color: "var(--ink)",
  font: "inherit",
};

const th: React.CSSProperties = {
  padding: "6px 8px",
  fontWeight: 500,
  fontSize: 12,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const td: React.CSSProperties = {
  padding: "8px",
  verticalAlign: "middle",
};
