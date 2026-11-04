"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ResponsiveSheet } from "./ResponsiveSheet";

/**
 * User-facing feedback surface. Four categories, routed to /api/feedback.
 *
 * Can be summoned two ways:
 *   1. The global "Feedback" button in the footer (no prefill).
 *   2. The in-game "Report this recipe" entry on Combine, which seeds
 *      `initial` with `type: "report"` + recipe context.
 */

export type FeedbackType =
  | "suggest_item"
  | "suggest_recipe"
  | "report"
  | "other";

export interface FeedbackPrefill {
  type: FeedbackType;
  payload?: Record<string, unknown>;
}

export function FeedbackSheet({
  open,
  onDismiss,
  initial,
  signedIn,
}: {
  open: boolean;
  onDismiss: () => void;
  initial?: FeedbackPrefill;
  /** When false, the "suggest recipe" category shows a sign-in prompt. */
  signedIn: boolean;
}) {
  const [type, setType] = useState<FeedbackType>(initial?.type ?? "suggest_item");
  const [state, setState] = useState<FormState>(() => emptyState(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Reset whenever the sheet opens (or the prefill changes).
  useEffect(() => {
    if (!open) return;
    setType(initial?.type ?? "suggest_item");
    setState(emptyState(initial));
    setError(null);
    setDone(false);
    setBusy(false);
  }, [open, initial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = buildPayload(type, state);
    if (!payload) {
      setError("Please fill in the fields.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          payload,
          url: typeof window !== "undefined" ? window.location.href : null,
        }),
      });
      if (!res.ok) {
        let msg = `request_failed_${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch {}
        if (res.status === 429) msg = "You've sent a lot of feedback — please try again in an hour.";
        else if (msg === "auth_required") msg = "Please sign in to suggest a recipe.";
        else if (msg === "invalid_payload") msg = "Please fill in the fields.";
        throw new Error(msg);
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveSheet open={open} onDismiss={onDismiss} ariaLabel="Send feedback">
      <div style={{ padding: 16, maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Feedback</h2>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="btn"
            onClick={onDismiss}
            style={{ fontSize: 12, padding: "2px 10px" }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {done ? (
          <div>
            <p style={{ margin: "8px 0" }}>Thanks &mdash; we&rsquo;ll take a look.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDone(false);
                  setState(emptyState());
                }}
              >
                Send another
              </button>
              <button type="button" className="btn" onClick={onDismiss}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
              <legend style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                What&rsquo;s this about?
              </legend>
              <div style={{ display: "grid", gap: 6 }}>
                {(
                  [
                    ["suggest_item", "Suggest an item"],
                    ["suggest_recipe", "Suggest a recipe"],
                    ["report", "Something looks wrong"],
                    ["other", "Other / feedback"],
                  ] as Array<[FeedbackType, string]>
                ).map(([value, label]) => (
                  <label
                    key={value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      border: "1.5px solid var(--ink)",
                      borderRadius: 3,
                      background: type === value ? "var(--soft)" : "var(--surface)",
                      cursor: "pointer",
                      fontSize: 14,
                    }}
                  >
                    <input
                      type="radio"
                      name="feedback-type"
                      value={value}
                      checked={type === value}
                      onChange={() => setType(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            {type === "suggest_recipe" && !signedIn ? (
              <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
                Recipe suggestions need an account so we can credit you and reply.{" "}
                <Link href="/sign-in">Sign in</Link>.
              </p>
            ) : (
              <TypeFields type={type} state={state} setState={setState} />
            )}

            {error && (
              <p style={{ margin: 0, color: "#f85149", fontSize: 13 }}>{error}</p>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={onDismiss}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={busy || (type === "suggest_recipe" && !signedIn)}
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        )}
      </div>
    </ResponsiveSheet>
  );
}

interface FormState {
  // suggest_item
  itemName: string;
  itemContext: string;
  // suggest_recipe
  recipeOutput: string;
  recipeInputs: string;
  recipeNote: string;
  // report
  reportNote: string;
  reportCategory: string | null;
  reportRecipeId: string | null;
  reportItemId: string | null;
  reportRecipeInputs: string[] | null;
  // other
  otherNote: string;
}

function emptyState(prefill?: FeedbackPrefill): FormState {
  const p = (prefill?.payload ?? {}) as Record<string, unknown>;
  return {
    itemName: typeof p.name === "string" ? p.name : "",
    itemContext: typeof p.context === "string" ? p.context : "",
    recipeOutput: typeof p.output === "string" ? p.output : "",
    recipeInputs: Array.isArray(p.inputs) ? (p.inputs as string[]).join(", ") : "",
    recipeNote: typeof p.note === "string" && prefill?.type === "suggest_recipe"
      ? p.note
      : "",
    reportNote: typeof p.note === "string" && prefill?.type === "report" ? p.note : "",
    reportCategory: typeof p.category === "string" ? p.category : null,
    reportRecipeId: typeof p.recipeId === "string" ? p.recipeId : null,
    reportItemId: typeof p.itemId === "string" ? p.itemId : null,
    reportRecipeInputs: Array.isArray(p.recipeInputs)
      ? (p.recipeInputs as string[])
      : null,
    otherNote: typeof p.note === "string" && prefill?.type === "other" ? p.note : "",
  };
}

function buildPayload(
  type: FeedbackType,
  s: FormState,
): Record<string, unknown> | null {
  if (type === "suggest_item") {
    const name = s.itemName.trim();
    if (!name) return null;
    const context = s.itemContext.trim();
    return context ? { name, context } : { name };
  }
  if (type === "suggest_recipe") {
    const inputs = s.recipeInputs
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (inputs.length < 2) return null;
    const output = s.recipeOutput.trim();
    const note = s.recipeNote.trim();
    return {
      inputs,
      ...(output ? { output } : {}),
      ...(note ? { note } : {}),
    };
  }
  if (type === "report") {
    const note = s.reportNote.trim();
    if (!note && !s.reportRecipeId && !s.reportItemId) return null;
    return {
      ...(s.reportCategory ? { category: s.reportCategory } : {}),
      ...(note ? { note } : {}),
      ...(s.reportRecipeId ? { recipeId: s.reportRecipeId } : {}),
      ...(s.reportItemId ? { itemId: s.reportItemId } : {}),
      ...(s.reportRecipeInputs ? { recipeInputs: s.reportRecipeInputs } : {}),
    };
  }
  const note = s.otherNote.trim();
  if (!note) return null;
  return { note };
}

function TypeFields({
  type,
  state,
  setState,
}: {
  type: FeedbackType;
  state: FormState;
  setState: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  if (type === "suggest_item") {
    return (
      <>
        <Field label="Item name" required>
          <input
            value={state.itemName}
            onChange={(e) => setState((s) => ({ ...s, itemName: e.target.value }))}
            placeholder="e.g. opal"
            style={inputStyle}
            required
          />
        </Field>
        <Field
          label="Where did you expect to find it?"
          hint="Optional — helps us slot it in."
        >
          <textarea
            value={state.itemContext}
            onChange={(e) => setState((s) => ({ ...s, itemContext: e.target.value }))}
            rows={3}
            placeholder="I was looking for it under…"
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </Field>
      </>
    );
  }
  if (type === "suggest_recipe") {
    return (
      <>
        <Field label="Inputs (comma-separated)" required>
          <input
            value={state.recipeInputs}
            onChange={(e) => setState((s) => ({ ...s, recipeInputs: e.target.value }))}
            placeholder="e.g. clay, fire"
            style={inputStyle}
            required
          />
        </Field>
        <Field label="Output" hint="What should the recipe make?">
          <input
            value={state.recipeOutput}
            onChange={(e) => setState((s) => ({ ...s, recipeOutput: e.target.value }))}
            placeholder="e.g. brick"
            style={inputStyle}
          />
        </Field>
        <Field label="Note" hint="Optional — why this recipe makes sense.">
          <textarea
            value={state.recipeNote}
            onChange={(e) => setState((s) => ({ ...s, recipeNote: e.target.value }))}
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </Field>
      </>
    );
  }
  if (type === "report") {
    const subject = reportSubject(state);
    return (
      <>
        {subject && (
          <div
            style={{
              fontSize: 13,
              color: "var(--muted)",
              padding: "8px 10px",
              background: "var(--soft)",
              borderRadius: 3,
            }}
          >
            Reporting {subject.kind}: <strong>{subject.label}</strong>
          </div>
        )}
        <Field label="What’s wrong?" required>
          <textarea
            value={state.reportNote}
            onChange={(e) => setState((s) => ({ ...s, reportNote: e.target.value }))}
            rows={4}
            placeholder="This doesn’t feel right because…"
            style={{ ...inputStyle, resize: "vertical" }}
            required
          />
        </Field>
      </>
    );
  }
  return (
    <Field label="Your feedback" required>
      <textarea
        value={state.otherNote}
        onChange={(e) => setState((s) => ({ ...s, otherNote: e.target.value }))}
        rows={5}
        style={{ ...inputStyle, resize: "vertical" }}
        required
      />
    </Field>
  );
}

function reportSubject(
  s: FormState,
): { kind: "item" | "recipe"; label: string } | null {
  const inputs = s.reportRecipeInputs ?? [];
  const isRecipe =
    s.reportCategory === "recipe_wrong" || inputs.includes("=");
  const isItem = s.reportCategory === "item_wrong";
  if (isRecipe) {
    if (inputs.length === 0) return null;
    // Combine seeds recipe reports as [a, b, "=", c]; render with " + " joining
    // ingredients and " = " for the output so it reads naturally.
    const eqAt = inputs.indexOf("=");
    const label =
      eqAt >= 0
        ? `${inputs.slice(0, eqAt).join(" + ")} = ${inputs.slice(eqAt + 1).join(", ")}`
        : inputs.join(" + ");
    return { kind: "recipe", label };
  }
  if (isItem && inputs.length > 0) {
    return { kind: "item", label: inputs[0] };
  }
  // Falls back when seeded but category missing — show whatever names we have.
  if (inputs.length > 0) {
    return { kind: inputs.includes("=") ? "recipe" : "item", label: inputs.join(" ") };
  }
  return null;
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>
        {label}
        {required && <span style={{ color: "#f85149" }}> *</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: "var(--muted)" }}>{hint}</span>}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 15,
  border: "1.5px solid var(--ink)",
  borderRadius: 3,
  background: "var(--surface)",
  color: "var(--ink)",
  fontFamily: "inherit",
};
