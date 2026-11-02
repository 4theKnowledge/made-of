"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

export interface ThemeRow {
  code: string;
  label: string;
  description: string | null;
  position: number;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

const CODE_RE = /^[a-z][a-z0-9-]*$/;

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `request_failed_${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) msg = body.message;
      else if (body?.error) msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

const api = {
  create: (body: { code: string; label: string; description?: string | null }) =>
    send<{ theme: ThemeRow }>("/api/admin/combine-themes", { method: "POST", body: JSON.stringify(body) }),
  patch: (code: string, body: Partial<Pick<ThemeRow, "label" | "description" | "position">>) =>
    send<{ theme: ThemeRow }>(`/api/admin/combine-themes/${encodeURIComponent(code)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  del: (code: string) =>
    send<{ ok: true }>(`/api/admin/combine-themes/${encodeURIComponent(code)}`, { method: "DELETE" }),
};

interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
}

export function ThemesAdmin({ initial }: { initial: ThemeRow[] }) {
  const [rows, setRows] = useState<ThemeRow[]>(initial);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const toast = useCallback((text: string, kind: Toast["kind"] = "error") => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const mutate = useCallback(
    async <T,>(
      optimistic: (prev: ThemeRow[]) => ThemeRow[],
      request: () => Promise<T>,
      onSuccess?: (result: T, applied: ThemeRow[]) => ThemeRow[] | void,
      errorPrefix = "Request failed",
    ) => {
      let previous: ThemeRow[] | null = null;
      setRows((prev) => {
        previous = prev;
        return optimistic(prev);
      });
      try {
        const result = await request();
        if (onSuccess) setRows((prev) => onSuccess(result, prev) ?? prev);
        return result;
      } catch (e) {
        if (previous) setRows(previous);
        const msg = e instanceof Error ? e.message : String(e);
        toast(`${errorPrefix}: ${msg}`);
        throw e;
      }
    },
    [toast],
  );

  const createTheme = useCallback(
    async (input: { code: string; label: string; description: string | null }) => {
      const now = new Date().toISOString();
      const position = rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0;
      const optimistic: ThemeRow = { ...input, position, itemCount: 0, createdAt: now, updatedAt: now };
      await mutate(
        (prev) => [...prev, optimistic],
        () => api.create(input),
        (result, applied) =>
          applied.map((r) =>
            r.code === input.code
              ? { ...r, ...result.theme, itemCount: 0, createdAt: toIso(result.theme.createdAt), updatedAt: toIso(result.theme.updatedAt) }
              : r,
          ),
        "Create failed",
      );
    },
    [rows, mutate],
  );

  const patchTheme = useCallback(
    async (code: string, patch: Partial<Pick<ThemeRow, "label" | "description" | "position">>) => {
      await mutate(
        (prev) => prev.map((r) => (r.code === code ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r)),
        () => api.patch(code, patch),
        (result, applied) =>
          applied.map((r) =>
            r.code === code ? { ...r, ...result.theme, updatedAt: toIso(result.theme.updatedAt) } : r,
          ),
        "Update failed",
      );
    },
    [mutate],
  );

  const deleteTheme = useCallback(
    async (code: string) => {
      await mutate((prev) => prev.filter((r) => r.code !== code), () => api.del(code), undefined, "Delete failed");
    },
    [mutate],
  );

  const sorted = rows.slice().sort((a, b) => a.position - b.position);

  return (
    <div>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
        {!showAdd ? (
          <button type="button" className="btn" style={{ fontSize: 12 }} onClick={() => setShowAdd(true)}>
            + Add theme
          </button>
        ) : (
          <AddForm
            onCancel={() => setShowAdd(false)}
            onSubmit={async (input) => {
              await createTheme(input);
              setShowAdd(false);
            }}
          />
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
              <th style={th}>Code</th>
              <th style={th}>Label</th>
              <th style={th}>Description</th>
              <th style={{ ...th, textAlign: "right" }}>Items</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.code} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ ...td, fontFamily: "var(--mono, monospace)", fontSize: 12 }}>{row.code}</td>
                <td style={td}>
                  {editing === row.code ? (
                    <EditRow
                      row={row}
                      onCancel={() => setEditing(null)}
                      onSubmit={async (patch) => {
                        await patchTheme(row.code, patch);
                        setEditing(null);
                      }}
                    />
                  ) : (
                    <span style={{ fontWeight: 500 }}>{row.label}</span>
                  )}
                </td>
                <td style={{ ...td, color: "var(--muted)" }}>
                  {editing === row.code ? null : row.description || <span style={{ opacity: 0.5 }}>—</span>}
                </td>
                <td style={{ ...td, textAlign: "right", fontFamily: "var(--mono, monospace)" }}>{row.itemCount}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  {editing === row.code ? null : (
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <Link href={`/admin/combine/themes/${encodeURIComponent(row.code)}`} className="btn" style={smallBtn}>
                        Validate
                      </Link>
                      <button type="button" className="btn" style={smallBtn} onClick={() => setEditing(row.code)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ ...smallBtn, color: "#f85149" }}
                        disabled={row.itemCount > 0}
                        title={row.itemCount > 0 ? `${row.itemCount} item(s) still in this theme` : "Delete this theme"}
                        onClick={async () => {
                          if (!confirm(`Delete theme "${row.code}"?`)) return;
                          await deleteTheme(row.code);
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>
                  No themes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {toasts.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            zIndex: 100,
          }}
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
              style={{
                background: t.kind === "error" ? "#f85149" : "var(--surface)",
                color: t.kind === "error" ? "#fff" : "var(--ink)",
                border: "1.5px solid var(--ink)",
                borderRadius: 3,
                boxShadow: "2px 2px 0 var(--ink)",
                padding: "8px 12px",
                fontSize: 13,
                cursor: "pointer",
                maxWidth: 320,
              }}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function toIso(v: string | Date | undefined): string {
  if (!v) return new Date().toISOString();
  if (typeof v === "string") return v;
  return v.toISOString();
}

function AddForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: { code: string; label: string; description: string | null }) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const codeValid = !code || CODE_RE.test(code);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!CODE_RE.test(code) || !label.trim()) return;
        setBusy(true);
        try {
          await onSubmit({ code: code.trim(), label: label.trim(), description: description.trim() || null });
          setCode("");
          setLabel("");
          setDescription("");
        } catch {
          // toast shown
        } finally {
          setBusy(false);
        }
      }}
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
    >
      <input
        placeholder="code"
        value={code}
        onChange={(e) => setCode(e.target.value.toLowerCase())}
        required
        autoFocus
        style={{ ...input, width: 140, fontFamily: "var(--mono, monospace)", borderColor: codeValid ? undefined : "#f85149" }}
      />
      <input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} required style={{ ...input, width: 180 }} />
      <input
        placeholder="description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{ ...input, flex: "1 1 240px", minWidth: 160 }}
      />
      <button type="submit" className="btn" style={smallBtn} disabled={busy || !codeValid || !code || !label.trim()}>
        {busy ? "…" : "Add"}
      </button>
      <button type="button" className="btn" style={smallBtn} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function EditRow({
  row,
  onCancel,
  onSubmit,
}: {
  row: ThemeRow;
  onCancel: () => void;
  onSubmit: (patch: { label?: string; description?: string | null }) => Promise<void>;
}) {
  const [label, setLabel] = useState(row.label);
  const [description, setDescription] = useState(row.description ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!label.trim()) return;
        setBusy(true);
        try {
          await onSubmit({ label: label.trim(), description: description.trim() || null });
        } finally {
          setBusy(false);
        }
      }}
      style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
    >
      <input value={label} onChange={(e) => setLabel(e.target.value)} required style={{ ...input, width: 160 }} />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="description"
        style={{ ...input, width: 220 }}
      />
      <button type="submit" className="btn" style={smallBtn} disabled={busy}>
        {busy ? "…" : "Save"}
      </button>
      <button type="button" className="btn" style={smallBtn} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

const th: React.CSSProperties = { padding: "6px 10px", fontSize: 12, color: "var(--muted)" };
const td: React.CSSProperties = { padding: "6px 10px" };
const input: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  border: "1px solid var(--line)",
  borderRadius: 3,
  background: "var(--card)",
  color: "var(--ink)",
};
const smallBtn: React.CSSProperties = { fontSize: 11, padding: "2px 8px" };
