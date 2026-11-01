"use client";

import { useState } from "react";

interface ImportResult {
  ok: boolean;
  dryRun: boolean;
  stats: { items: number; recipes: number; links: number; evidence: number; sources: number; canaries: number };
  warnings: string[];
  errors: string[];
  snapshotVersion?: number;
}

export function ImportForm() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  async function submit(dryRun: boolean) {
    setBusy(true);
    setResult(null);
    setParseError(null);
    try {
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Invalid JSON");
        return;
      }
      const res = await fetch(`/api/admin/import?dryRun=${dryRun ? 1 : 0}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const r = (await res.json()) as ImportResult;
      setResult(r);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={16}
        placeholder='{"items": [...], "evidenceLinks": [...], "sources": {...}}'
        style={{
          width: "100%",
          fontFamily: "var(--mono, monospace)",
          fontSize: 12,
          padding: 10,
          border: "1px solid var(--line)",
          borderRadius: 4,
        }}
      />
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button className="btn" disabled={busy || !text.trim()} onClick={() => submit(true)}>
          {busy ? "…" : "Dry-run"}
        </button>
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => submit(false)}>
          {busy ? "…" : "Apply"}
        </button>
      </div>
      {parseError && <p style={{ color: "var(--bad, #a62828)", marginTop: 10 }}>Parse: {parseError}</p>}
      {result && (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid var(--line)", borderRadius: 4 }}>
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 12, color: "var(--muted)" }}>
            {result.dryRun ? "DRY-RUN · ROLLED BACK" : result.ok ? "APPLIED" : "FAILED"}
            {result.snapshotVersion != null ? ` · snapshot v${result.snapshotVersion}` : ""}
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: "8px 0 0 0", fontSize: 14 }}>
            <dt style={{ color: "var(--muted)" }}>Items</dt><dd style={{ margin: 0 }}>{result.stats.items}</dd>
            <dt style={{ color: "var(--muted)" }}>Recipes</dt><dd style={{ margin: 0 }}>{result.stats.recipes}</dd>
            <dt style={{ color: "var(--muted)" }}>Links</dt><dd style={{ margin: 0 }}>{result.stats.links}</dd>
            <dt style={{ color: "var(--muted)" }}>Evidence</dt><dd style={{ margin: 0 }}>{result.stats.evidence}</dd>
            <dt style={{ color: "var(--muted)" }}>Sources</dt><dd style={{ margin: 0 }}>{result.stats.sources}</dd>
            <dt style={{ color: "var(--muted)" }}>Canaries</dt><dd style={{ margin: 0 }}>{result.stats.canaries}</dd>
          </dl>
          {result.warnings.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 11, color: "var(--warn, #a66400)" }}>Warnings</div>
              <ul style={{ margin: "4px 0 0 20px", fontSize: 13 }}>
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          {result.errors.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 11, color: "var(--bad, #a62828)" }}>Errors</div>
              <ul style={{ margin: "4px 0 0 20px", fontSize: 13 }}>
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
