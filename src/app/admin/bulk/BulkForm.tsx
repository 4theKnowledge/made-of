"use client";

/**
 * Three-step bulk upload UI.
 *
 *   1. Paste  — admin pastes the pack JSON.
 *   2. Review — show plan (errors, warnings, item dispositions with
 *               per-item merge/insert/skip radios).
 *   3. Apply  — commit the plan with the admin's decisions.
 *
 * Dry-run runs the full transaction and rolls it back, so stats are
 * accurate without touching the DB.
 */

import { useMemo, useState } from "react";
import type { Plan, ItemDecision, ItemPlanEntry } from "@/lib/bulk-upload/types";

type Step = "paste" | "review" | "done";

interface AuditOffender {
  name: string;
}

interface Audit {
  orphans: Array<AuditOffender & { tier: string; kind: string }>;
  deadEndRaws: Array<AuditOffender & { theme: string; outputs: string[] }>;
}

interface ApplyResponse {
  ok: boolean;
  dryRun: boolean;
  stats: {
    itemsInserted: number;
    itemsMerged: number;
    itemsSkipped: number;
    recipesInserted: number;
    linksInserted: number;
    linksSkippedDuplicate: number;
    sourcesInserted: number;
    evidenceInserted: number;
  };
  issues: Plan["issues"];
  errors: string[];
  audit?: Audit;
  snapshotVersion?: number;
}

export function BulkForm() {
  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [packJson, setPackJson] = useState<unknown>(null);
  const [decisions, setDecisions] = useState<Record<string, ItemDecision>>({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResponse | null>(null);

  async function requestPlan() {
    setParseError(null);
    setApiError(null);
    setPlan(null);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    // The template includes a top-level _readme that should be stripped
    // before sending — the API doesn't look at it, but strip anyway to
    // avoid noise if the admin ever starts from the raw template.
    if (body && typeof body === "object" && "_readme" in body) {
      delete (body as Record<string, unknown>)._readme;
    }
    setPackJson(body);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/bulk/plan", {
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
      // Seed decisions from planner defaults.
      const seed: Record<string, ItemDecision> = {};
      for (const entry of data.plan.items) seed[entry.name] = entry.decision;
      setDecisions(seed);
      setStep("review");
    } finally {
      setBusy(false);
    }
  }

  async function runApply(dryRun: boolean) {
    if (!packJson) return;
    setBusy(true);
    setApiError(null);
    try {
      const res = await fetch("/api/admin/bulk/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack: packJson, decisions, dryRun }),
      });
      const data = (await res.json()) as ApplyResponse;
      setApplyResult(data);
      if (data.ok && !data.dryRun) setStep("done");
    } finally {
      setBusy(false);
    }
  }

  const errors = useMemo(
    () => plan?.issues.filter((i) => i.severity === "error") ?? [],
    [plan],
  );
  const warnings = useMemo(
    () => plan?.issues.filter((i) => i.severity === "warning") ?? [],
    [plan],
  );
  const unresolvedDecisions = useMemo(() => {
    if (!plan) return [] as ItemPlanEntry[];
    return plan.items.filter((entry) => {
      const d = decisions[entry.name] ?? entry.decision;
      // slug collisions default to skip but admin should actively confirm;
      // we still allow apply with the default. The real blockers are
      // insert-when-colliding and merge-when-no-target, which the apply
      // route rejects.
      if (d === "insert" && entry.disposition.kind === "name_collision") return true;
      if (d === "insert" && entry.disposition.kind === "slug_collision") return true;
      if (d === "merge" && entry.disposition.kind === "new") return true;
      return false;
    });
  }, [plan, decisions]);
  const canApply =
    plan !== null && errors.length === 0 && unresolvedDecisions.length === 0;

  function setDecision(name: string, decision: ItemDecision) {
    setDecisions((prev) => ({ ...prev, [name]: decision }));
  }

  function reset() {
    setStep("paste");
    setPlan(null);
    setPackJson(null);
    setDecisions({});
    setApiError(null);
    setApplyResult(null);
  }

  /* -------------------------- Step 1: paste -------------------------- */
  if (step === "paste") {
    return (
      <div>
        <h3 style={{ marginTop: 0 }}>1. Paste pack</h3>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={20}
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
          <button
            className="btn primary"
            disabled={busy || !text.trim()}
            onClick={requestPlan}
          >
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

  /* -------------------------- Step 2: review ------------------------- */
  if (step === "review" && plan) {
    return (
      <div>
        <h3 style={{ marginTop: 0 }}>2. Review plan</h3>
        <SummaryBar plan={plan} decisions={decisions} />

        {errors.length > 0 && (
          <IssueBlock title="Errors (block apply)" issues={errors} tone="error" />
        )}
        {warnings.length > 0 && (
          <IssueBlock title="Warnings" issues={warnings} tone="warning" />
        )}

        <h4 style={{ marginBottom: 8 }}>Items ({plan.items.length})</h4>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {plan.items.map((entry) => (
            <ItemRow
              key={entry.name}
              entry={entry}
              decision={decisions[entry.name] ?? entry.decision}
              onDecision={(d) => setDecision(entry.name, d)}
            />
          ))}
        </ul>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn" onClick={reset} disabled={busy}>
            Back
          </button>
          <button
            className="btn"
            disabled={!canApply || busy}
            onClick={() => runApply(true)}
            title="Run the import in a transaction and roll back"
          >
            {busy ? "…" : "Dry-run"}
          </button>
          <button
            className="btn primary"
            disabled={!canApply || busy}
            onClick={() => runApply(false)}
          >
            {busy ? "…" : "Apply"}
          </button>
        </div>

        {!canApply && unresolvedDecisions.length > 0 && (
          <p style={{ color: "var(--warn, #a66400)", marginTop: 10 }}>
            Choose a resolution for every colliding item.
          </p>
        )}

        {applyResult && applyResult.dryRun && (
          <ApplyResultBlock result={applyResult} />
        )}
        {apiError && (
          <p style={{ color: "var(--bad, #a62828)", marginTop: 10 }}>Error: {apiError}</p>
        )}
      </div>
    );
  }

  /* -------------------------- Step 3: done --------------------------- */
  if (step === "done" && applyResult) {
    return (
      <div>
        <h3 style={{ marginTop: 0 }}>3. Applied</h3>
        <ApplyResultBlock result={applyResult} />
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn" onClick={reset}>
            Upload another pack
          </button>
        </div>
      </div>
    );
  }

  return null;
}

/* ------------------------------ helpers ----------------------------- */

function SummaryBar({ plan, decisions }: { plan: Plan; decisions: Record<string, ItemDecision> }) {
  let insert = 0;
  let merge = 0;
  let skip = 0;
  for (const entry of plan.items) {
    const d = decisions[entry.name] ?? entry.decision;
    if (d === "insert") insert += 1;
    else if (d === "merge") merge += 1;
    else skip += 1;
  }
  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, auto)",
        gap: "4px 20px",
        margin: "0 0 16px 0",
        fontSize: 13,
      }}
    >
      <Cell label="Insert" value={insert} />
      <Cell label="Merge" value={merge} />
      <Cell label="Skip" value={skip} />
      <Cell label="Links" value={plan.linkCount} />
      <Cell label="Evidence" value={plan.evidenceCount} />
    </dl>
  );
}

function Cell({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt style={{ color: "var(--muted)", margin: 0 }}>{label}</dt>
      <dd style={{ margin: 0, fontFamily: "var(--mono, monospace)" }}>{value}</dd>
    </>
  );
}

function IssueBlock({
  title,
  issues,
  tone,
}: {
  title: string;
  issues: Plan["issues"];
  tone: "error" | "warning";
}) {
  const colour = tone === "error" ? "var(--bad, #a62828)" : "var(--warn, #a66400)";
  return (
    <div
      style={{
        marginBottom: 16,
        padding: 10,
        border: `1px solid ${colour}`,
        borderRadius: 4,
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono, monospace)",
          fontSize: 11,
          color: colour,
          marginBottom: 6,
        }}
      >
        {title} ({issues.length})
      </div>
      <ul style={{ margin: "0 0 0 20px", fontSize: 13 }}>
        {issues.map((i, idx) => (
          <li key={idx}>
            {i.at ? <strong>{i.at}: </strong> : null}
            {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemRow({
  entry,
  decision,
  onDecision,
}: {
  entry: ItemPlanEntry;
  decision: ItemDecision;
  onDecision: (d: ItemDecision) => void;
}) {
  const d = entry.disposition;
  let label: string;
  let note: string | null = null;
  switch (d.kind) {
    case "new":
      label = "new";
      break;
    case "name_collision":
      label = "name exists";
      note = "An item with this exact name already exists.";
      break;
    case "slug_collision":
      label = "slug clash";
      note = `Slug "${entry.slug}" is used by "${d.existingName}".`;
      break;
    case "fuzzy_match":
      label = "near match";
      note = `Looks similar to existing item "${d.existingName}".`;
      break;
  }

  const options: Array<{ value: ItemDecision; label: string; disabled?: boolean }> = [
    { value: "insert", label: "Insert", disabled: d.kind === "name_collision" || d.kind === "slug_collision" },
    { value: "merge", label: "Merge", disabled: d.kind === "new" },
    { value: "skip", label: "Skip" },
  ];

  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 8,
        padding: "8px 10px",
        borderBottom: "1px solid var(--line)",
        alignItems: "center",
      }}
    >
      <div>
        <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 13 }}>{entry.name}</span>
        <span
          style={{
            marginLeft: 10,
            fontSize: 10,
            fontFamily: "var(--mono, monospace)",
            padding: "1px 6px",
            borderRadius: 3,
            border: "1px solid var(--line)",
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {label}
        </span>
        {note && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{note}</div>}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {options.map((o) => (
          <label
            key={o.value}
            style={{
              fontSize: 12,
              color: o.disabled ? "var(--muted)" : "inherit",
              opacity: o.disabled ? 0.5 : 1,
              cursor: o.disabled ? "not-allowed" : "pointer",
            }}
          >
            <input
              type="radio"
              name={`decision:${entry.name}`}
              checked={decision === o.value}
              disabled={o.disabled}
              onChange={() => onDecision(o.value)}
              style={{ marginRight: 4 }}
            />
            {o.label}
          </label>
        ))}
      </div>
    </li>
  );
}

function ApplyResultBlock({ result }: { result: ApplyResponse }) {
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
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "4px 12px",
          margin: "8px 0 0 0",
          fontSize: 13,
        }}
      >
        <dt style={{ color: "var(--muted)" }}>Items inserted</dt>
        <dd style={{ margin: 0 }}>{result.stats.itemsInserted}</dd>
        <dt style={{ color: "var(--muted)" }}>Items merged</dt>
        <dd style={{ margin: 0 }}>{result.stats.itemsMerged}</dd>
        <dt style={{ color: "var(--muted)" }}>Items skipped</dt>
        <dd style={{ margin: 0 }}>{result.stats.itemsSkipped}</dd>
        <dt style={{ color: "var(--muted)" }}>Recipes</dt>
        <dd style={{ margin: 0 }}>{result.stats.recipesInserted}</dd>
        <dt style={{ color: "var(--muted)" }}>Links</dt>
        <dd style={{ margin: 0 }}>
          {result.stats.linksInserted}
          {result.stats.linksSkippedDuplicate > 0 && (
            <span style={{ color: "var(--muted)", marginLeft: 8 }}>
              ({result.stats.linksSkippedDuplicate} duplicates skipped)
            </span>
          )}
        </dd>
        <dt style={{ color: "var(--muted)" }}>Sources</dt>
        <dd style={{ margin: 0 }}>{result.stats.sourcesInserted}</dd>
        <dt style={{ color: "var(--muted)" }}>Evidence</dt>
        <dd style={{ margin: 0 }}>{result.stats.evidenceInserted}</dd>
      </dl>
      {result.audit && (
        <AuditBlock audit={result.audit} />
      )}
      {result.errors.length > 0 && !result.audit && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 11, color: "var(--bad, #a62828)" }}>
            Errors
          </div>
          <ul style={{ margin: "4px 0 0 20px", fontSize: 13 }}>
            {result.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AuditBlock({ audit }: { audit: Audit }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontFamily: "var(--mono, monospace)",
          fontSize: 11,
          color: "var(--bad, #a62828)",
        }}
      >
        Graph invariants violated — pack rolled back
      </div>
      {audit.orphans.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {audit.orphans.length} item(s) with no upstream path to “big bang”:
          </div>
          <ul style={{ margin: "4px 0 0 20px", fontSize: 13 }}>
            {audit.orphans.map((o) => (
              <li key={o.name}>
                {o.name}{" "}
                <span style={{ color: "var(--muted)" }}>
                  ({o.tier}/{o.kind})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {audit.deadEndRaws.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {audit.deadEndRaws.length} dead-end raw item(s) in Combine themes:
          </div>
          <ul style={{ margin: "4px 0 0 20px", fontSize: 13 }}>
            {audit.deadEndRaws.map((o) => (
              <li key={`${o.theme}:${o.name}`}>
                <span style={{ color: "var(--muted)" }}>[{o.theme}]</span>{" "}
                {o.name} → {o.outputs.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
