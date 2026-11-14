"use client";

/**
 * Download panel for the bulk-upload page.
 *
 * Two preset buttons cover the common cases; a collapsed `<details>` block
 * holds a decision-tree custom-download form for everything else.
 *
 * Decision tree in the custom form:
 *   Step 1: Template or Snapshot?
 *     Template  → KB template or Pictogram style guide?
 *     Snapshot  → Compact or Full?  →  Include schema/vocab? Y/N
 */

import { useState } from "react";

type Kind = "template" | "snapshot";
type TemplateChoice = "kb" | "pictogram";
type SnapshotMode = "compact" | "full";

export function DownloadPanel() {
  const [kind, setKind] = useState<Kind>("snapshot");
  const [templateChoice, setTemplateChoice] = useState<TemplateChoice>("kb");
  const [snapshotMode, setSnapshotMode] = useState<SnapshotMode>("compact");
  const [includeSchema, setIncludeSchema] = useState(true);

  const customHref = buildHref({
    kind,
    templateChoice,
    snapshotMode,
    includeSchema,
  });
  const customLabel = buildLabel({
    kind,
    templateChoice,
    snapshotMode,
    includeSchema,
  });

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
        <a
          href="/api/admin/bulk/snapshot?mode=compact&includeSchema=1"
          className="btn"
          download
          title="Compact KB dump with vocab + field schema embedded. The default to give an AI agent."
        >
          Compact snapshot + schema
        </a>
        <a
          href="/api/admin/bulk/snapshot"
          className="btn"
          download
          title="Full round-trippable KB export (items, evidence, sources, kinds, pictograms)."
        >
          Full snapshot
        </a>
        <a href="/api/admin/bulk/template" className="btn" download>
          Template (worked example)
        </a>
        <a href="/api/admin/bulk/pictogram-style" className="btn" download>
          Pictogram style guide
        </a>
      </div>

      <details style={{ marginTop: 14 }}>
        <summary
          style={{
            cursor: "pointer",
            fontSize: 13,
            color: "var(--muted)",
            userSelect: "none",
          }}
        >
          Custom download…
        </summary>
        <div
          style={{
            marginTop: 10,
            padding: 12,
            border: "1px solid var(--line)",
            borderRadius: 3,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            fontSize: 13,
          }}
        >
          <Radio
            label="Type"
            value={kind}
            onChange={(v) => setKind(v as Kind)}
            options={[
              { value: "snapshot", label: "Snapshot (live KB dump)" },
              { value: "template", label: "Template (worked example / style guide)" },
            ]}
          />

          {kind === "template" && (
            <Radio
              label="Which template"
              value={templateChoice}
              onChange={(v) => setTemplateChoice(v as TemplateChoice)}
              options={[
                { value: "kb", label: "KB bulk-upload template" },
                { value: "pictogram", label: "Pictogram style guide" },
              ]}
            />
          )}

          {kind === "snapshot" && (
            <>
              <Radio
                label="Snapshot size"
                value={snapshotMode}
                onChange={(v) => setSnapshotMode(v as SnapshotMode)}
                options={[
                  {
                    value: "compact",
                    label: "Compact — drops evidence, sources, pictogram SVGs",
                  },
                  {
                    value: "full",
                    label: "Full — round-trippable export (larger)",
                  },
                ]}
              />
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={includeSchema}
                  onChange={(e) => setIncludeSchema(e.target.checked)}
                />
                Include schema &amp; vocab (<code>_readme</code> block) — recommended
                when handing to an AI agent
              </label>
            </>
          )}

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              marginTop: 4,
            }}
          >
            <a href={customHref} className="btn" download>
              Download
            </a>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              {customLabel}
            </span>
          </div>
        </div>
      </details>
    </div>
  );
}

function buildHref(opts: {
  kind: Kind;
  templateChoice: TemplateChoice;
  snapshotMode: SnapshotMode;
  includeSchema: boolean;
}): string {
  if (opts.kind === "template") {
    return opts.templateChoice === "kb"
      ? "/api/admin/bulk/template"
      : "/api/admin/bulk/pictogram-style";
  }
  const params = new URLSearchParams();
  if (opts.snapshotMode === "compact") params.set("mode", "compact");
  if (opts.includeSchema) params.set("includeSchema", "1");
  const qs = params.toString();
  return `/api/admin/bulk/snapshot${qs ? `?${qs}` : ""}`;
}

function buildLabel(opts: {
  kind: Kind;
  templateChoice: TemplateChoice;
  snapshotMode: SnapshotMode;
  includeSchema: boolean;
}): string {
  if (opts.kind === "template") {
    return opts.templateChoice === "kb"
      ? "KB bulk-upload template with full worked example"
      : "Pictogram authoring style guide";
  }
  const size = opts.snapshotMode === "compact" ? "compact" : "full";
  const schema = opts.includeSchema ? "with schema" : "without schema";
  return `${size} snapshot, ${schema}`;
}

function Radio({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {options.map((o) => (
          <label
            key={o.value}
            style={{ display: "flex", gap: 8, alignItems: "center" }}
          >
            <input
              type="radio"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}
