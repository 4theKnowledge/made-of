"use client";

/**
 * Pictograms-only upload flow. Paste a {name: svg} dict → plan → review →
 * apply. Review step shows a per-entry row with a thumbnail preview of the
 * incoming SVG and the current value when the target already has one.
 */

import { useMemo, useState } from "react";

type TargetKind = "item" | "kind";
type EntryDisposition =
  | { kind: "fill_empty"; targetKind: TargetKind; targetKey: string; targetId: string }
  | { kind: "would_overwrite"; targetKind: TargetKind; targetKey: string; targetId: string; existing: string }
  | { kind: "orphan" }
  | { kind: "ambiguous"; itemId: string; kindCode: string }
  | { kind: "invalid_svg"; errors: string[] };

interface Entry {
  sourceKey: string;
  svg: string;
  disposition: EntryDisposition;
}

interface Plan {
  entries: Entry[];
}

type Decision = "insert" | "overwrite" | "skip";

interface ApplyResponse {
  ok: boolean;
  dryRun: boolean;
  stats: {
    itemsSet: number;
    kindsSet: number;
    overwrites: number;
    skippedOrphan: number;
    skippedAmbiguous: number;
    skippedInvalid: number;
  };
  errors: string[];
  snapshotVersion?: number;
}

type Step = "paste" | "review" | "done";

export function PictogramUploadForm() {
  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResponse | null>(null);

  async function requestPlan() {
    setParseError(null);
    setApiError(null);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    setPayload(body);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/bulk/pictograms/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; plan?: Plan; error?: string };
      if (!res.ok || !data.ok || !data.plan) {
        setApiError(data.error ?? `Plan failed (${res.status})`);
        return;
      }
      setPlan(data.plan);
      const seed: Record<string, Decision> = {};
      for (const e of data.plan.entries) seed[e.sourceKey] = defaultDecision(e.disposition);
      setDecisions(seed);
      setStep("review");
    } finally {
      setBusy(false);
    }
  }

  async function runApply(dryRun: boolean) {
    if (!payload) return;
    setBusy(true);
    setApiError(null);
    try {
      const res = await fetch("/api/admin/bulk/pictograms/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload, decisions, dryRun }),
      });
      const data = (await res.json()) as ApplyResponse;
      setResult(data);
      if (data.ok && !data.dryRun) setStep("done");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("paste");
    setPlan(null);
    setPayload(null);
    setDecisions({});
    setApiError(null);
    setResult(null);
  }

  const summary = useMemo(() => {
    if (!plan) return null;
    let fill = 0;
    let over = 0;
    let orphan = 0;
    let ambiguous = 0;
    let invalid = 0;
    for (const e of plan.entries) {
      switch (e.disposition.kind) {
        case "fill_empty":
          fill += 1;
          break;
        case "would_overwrite":
          over += 1;
          break;
        case "orphan":
          orphan += 1;
          break;
        case "ambiguous":
          ambiguous += 1;
          break;
        case "invalid_svg":
          invalid += 1;
          break;
      }
    }
    return { fill, over, orphan, ambiguous, invalid };
  }, [plan]);

  /* --- Step 1 --- */
  if (step === "paste") {
    return (
      <div>
        <h3 style={{ marginTop: 0 }}>1. Paste dict</h3>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={20}
          placeholder='{ "iron": "<path .../>", "copper": "<path .../>" }'
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
          <button className="btn primary" disabled={busy || !text.trim()} onClick={requestPlan}>
            {busy ? "…" : "Review"}
          </button>
        </div>
        {parseError && (
          <p style={{ color: "var(--bad, #a62828)", marginTop: 10 }}>Parse: {parseError}</p>
        )}
        {apiError && (
          <p style={{ color: "var(--bad, #a62828)", marginTop: 10 }}>Error: {apiError}</p>
        )}
      </div>
    );
  }

  /* --- Step 2 --- */
  if (step === "review" && plan && summary) {
    return (
      <div>
        <h3 style={{ marginTop: 0 }}>2. Review</h3>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, auto)",
            gap: "4px 20px",
            margin: "0 0 16px 0",
            fontSize: 13,
          }}
        >
          <Cell label="Fill empty" value={summary.fill} />
          <Cell label="Would overwrite" value={summary.over} />
          <Cell label="Orphan" value={summary.orphan} />
          <Cell label="Ambiguous" value={summary.ambiguous} />
          <Cell label="Invalid" value={summary.invalid} />
        </dl>

        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {plan.entries.map((entry) => (
            <EntryRow
              key={entry.sourceKey}
              entry={entry}
              decision={decisions[entry.sourceKey] ?? defaultDecision(entry.disposition)}
              onDecision={(d) =>
                setDecisions((prev) => ({ ...prev, [entry.sourceKey]: d }))
              }
            />
          ))}
        </ul>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn" onClick={reset} disabled={busy}>
            Back
          </button>
          <button className="btn" onClick={() => runApply(true)} disabled={busy}>
            {busy ? "…" : "Dry-run"}
          </button>
          <button className="btn primary" onClick={() => runApply(false)} disabled={busy}>
            {busy ? "…" : "Apply"}
          </button>
        </div>

        {result && result.dryRun && <ResultBlock result={result} />}
        {apiError && (
          <p style={{ color: "var(--bad, #a62828)", marginTop: 10 }}>Error: {apiError}</p>
        )}
      </div>
    );
  }

  /* --- Step 3 --- */
  if (step === "done" && result) {
    return (
      <div>
        <h3 style={{ marginTop: 0 }}>3. Applied</h3>
        <ResultBlock result={result} />
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn" onClick={reset}>
            Upload more
          </button>
        </div>
      </div>
    );
  }
  return null;
}

function defaultDecision(d: EntryDisposition): Decision {
  if (d.kind === "fill_empty") return "insert";
  return "skip";
}

function Cell({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt style={{ color: "var(--muted)", margin: 0 }}>{label}</dt>
      <dd style={{ margin: 0, fontFamily: "var(--mono, monospace)" }}>{value}</dd>
    </>
  );
}

function EntryRow({
  entry,
  decision,
  onDecision,
}: {
  entry: Entry;
  decision: Decision;
  onDecision: (d: Decision) => void;
}) {
  const d = entry.disposition;
  let label: string;
  let tone: "ok" | "warn" | "bad";
  switch (d.kind) {
    case "fill_empty":
      label = `${d.targetKind}: fill empty`;
      tone = "ok";
      break;
    case "would_overwrite":
      label = `${d.targetKind}: would overwrite`;
      tone = "warn";
      break;
    case "orphan":
      label = "orphan — no matching item or kind";
      tone = "bad";
      break;
    case "ambiguous":
      label = "ambiguous — matches both an item and a kind";
      tone = "bad";
      break;
    case "invalid_svg":
      label = "invalid SVG";
      tone = "bad";
      break;
  }

  const canOverwrite = d.kind === "would_overwrite";
  const canInsert = d.kind === "fill_empty" || d.kind === "would_overwrite";

  const toneColour =
    tone === "ok" ? "var(--good, #2a7a2a)" : tone === "warn" ? "var(--warn, #a66400)" : "var(--bad, #a62828)";

  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "80px 1fr auto",
        gap: 12,
        padding: "10px 12px",
        borderBottom: "1px solid var(--line)",
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", gap: 6 }}>
        {entry.svg ? (
          <PreviewTile svg={entry.svg} />
        ) : (
          <div style={{ width: 32, height: 32, border: "1px dashed var(--line)" }} />
        )}
        {d.kind === "would_overwrite" && (
          <PreviewTile svg={d.existing} dim />
        )}
      </div>
      <div>
        <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 13 }}>{entry.sourceKey}</div>
        <div style={{ fontSize: 11, color: toneColour, marginTop: 2 }}>{label}</div>
        {d.kind === "invalid_svg" && (
          <ul style={{ margin: "4px 0 0 20px", fontSize: 11, color: toneColour }}>
            {d.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
        <OptionRadio label="Insert" value="insert" current={decision} disabled={!canInsert} onChange={onDecision} />
        <OptionRadio
          label="Overwrite"
          value="overwrite"
          current={decision}
          disabled={!canOverwrite}
          onChange={onDecision}
        />
        <OptionRadio label="Skip" value="skip" current={decision} onChange={onDecision} />
      </div>
    </li>
  );
}

function OptionRadio({
  label,
  value,
  current,
  disabled,
  onChange,
}: {
  label: string;
  value: Decision;
  current: Decision;
  disabled?: boolean;
  onChange: (d: Decision) => void;
}) {
  return (
    <label
      style={{
        color: disabled ? "var(--muted)" : "inherit",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <input
        type="radio"
        checked={current === value}
        disabled={disabled}
        onChange={() => onChange(value)}
        style={{ marginRight: 4 }}
      />
      {label}
    </label>
  );
}

function PreviewTile({ svg, dim }: { svg: string; dim?: boolean }) {
  return (
    <span
      className="ic"
      style={{
        width: 32,
        height: 32,
        opacity: dim ? 0.5 : 1,
      }}
    >
      <svg viewBox="0 0 32 32" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
    </span>
  );
}

function ResultBlock({ result }: { result: ApplyResponse }) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: 12,
        border: "1px solid var(--line)",
        borderRadius: 4,
      }}
    >
      <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 12, color: "var(--muted)" }}>
        {result.dryRun ? "DRY-RUN · ROLLED BACK" : result.ok ? "APPLIED" : "FAILED"}
        {result.snapshotVersion != null ? ` · snapshot v${result.snapshotVersion}` : ""}
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: "8px 0 0 0", fontSize: 13 }}>
        <dt style={{ color: "var(--muted)" }}>Items set</dt>
        <dd style={{ margin: 0 }}>{result.stats.itemsSet}</dd>
        <dt style={{ color: "var(--muted)" }}>Kinds set</dt>
        <dd style={{ margin: 0 }}>{result.stats.kindsSet}</dd>
        <dt style={{ color: "var(--muted)" }}>Overwrites</dt>
        <dd style={{ margin: 0 }}>{result.stats.overwrites}</dd>
        <dt style={{ color: "var(--muted)" }}>Skipped (orphan)</dt>
        <dd style={{ margin: 0 }}>{result.stats.skippedOrphan}</dd>
        <dt style={{ color: "var(--muted)" }}>Skipped (ambiguous)</dt>
        <dd style={{ margin: 0 }}>{result.stats.skippedAmbiguous}</dd>
        <dt style={{ color: "var(--muted)" }}>Skipped (invalid)</dt>
        <dd style={{ margin: 0 }}>{result.stats.skippedInvalid}</dd>
      </dl>
      {result.errors.length > 0 && (
        <ul style={{ margin: "10px 0 0 20px", color: "var(--bad, #a62828)", fontSize: 13 }}>
          {result.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
