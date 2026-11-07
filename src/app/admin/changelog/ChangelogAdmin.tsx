"use client";

import { useCallback, useRef, useState } from "react";
import type { ChangelogStatus, ChangelogType } from "@/db/schema";
import { useConfirm } from "@/components/common/useConfirm";

export interface ChangelogRow {
  id: string;
  slug: string;
  title: string;
  type: ChangelogType;
  body: string;
  status: ChangelogStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const TYPES: ChangelogType[] = ["feature", "fix", "content", "note"];
const TYPE_LABELS: Record<ChangelogType, string> = {
  feature: "Feature",
  fix: "Fix",
  content: "Content",
  note: "Note",
};

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `request_failed_${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
      if (body?.message) msg = body.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

const api = {
  create: (body: { title: string; type: ChangelogType; body: string }) =>
    send<{ entry: ChangelogRow }>("/api/admin/changelog", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patch: (
    id: string,
    body: Partial<Pick<ChangelogRow, "title" | "type" | "body" | "status" | "slug">>,
  ) =>
    send<{ entry: ChangelogRow }>(`/api/admin/changelog/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  del: (id: string) =>
    send<{ ok: true }>(`/api/admin/changelog/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
}

export function ChangelogAdmin({ initial }: { initial: ChangelogRow[] }) {
  const [rows, setRows] = useState<ChangelogRow[]>(initial);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const [editing, setEditing] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [showAdd, setShowAdd] = useState(false);

  const toast = useCallback((text: string, kind: Toast["kind"] = "error") => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const mutate = useCallback(
    async <T,>(
      optimistic: (prev: ChangelogRow[]) => ChangelogRow[],
      request: () => Promise<T>,
      onSuccess?: (result: T, applied: ChangelogRow[]) => ChangelogRow[] | void,
      errorPrefix = "Request failed",
    ) => {
      let previous: ChangelogRow[] | null = null;
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

  const createEntry = useCallback(
    async (input: { title: string; type: ChangelogType; body: string }) => {
      const now = new Date().toISOString();
      const optimisticId = `tmp-${Date.now()}`;
      const optimistic: ChangelogRow = {
        id: optimisticId,
        slug: "",
        title: input.title,
        type: input.type,
        body: input.body,
        status: "draft",
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await mutate(
        (prev) => [optimistic, ...prev],
        () => api.create(input),
        (result, applied) =>
          applied.map((r) =>
            r.id === optimisticId ? normaliseRow(result.entry) : r,
          ),
        "Create failed",
      );
    },
    [mutate],
  );

  const patchEntry = useCallback(
    async (
      id: string,
      patch: Partial<Pick<ChangelogRow, "title" | "type" | "body" | "status" | "slug">>,
    ) => {
      await mutate(
        (prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r,
          ),
        () => api.patch(id, patch),
        (result, applied) =>
          applied.map((r) => (r.id === id ? normaliseRow(result.entry) : r)),
        "Update failed",
      );
    },
    [mutate],
  );

  const deleteEntry = useCallback(
    async (id: string) => {
      await mutate(
        (prev) => prev.filter((r) => r.id !== id),
        () => api.del(id),
        undefined,
        "Delete failed",
      );
    },
    [mutate],
  );

  return (
    <div>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
        {!showAdd ? (
          <button
            type="button"
            className="btn"
            style={{ fontSize: 12 }}
            onClick={() => setShowAdd(true)}
          >
            + New entry
          </button>
        ) : (
          <AddEntryForm
            onCancel={() => setShowAdd(false)}
            onSubmit={async (input) => {
              await createEntry(input);
              setShowAdd(false);
            }}
          />
        )}
      </div>

      <div>
        {rows.length === 0 && (
          <p style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>
            No entries yet. Create one to get started.
          </p>
        )}
        {rows.map((row) => (
          <div
            key={row.id}
            style={{ borderBottom: "1px solid var(--line)", padding: "12px 14px" }}
          >
            {editing === row.id ? (
              <EditEntryForm
                row={row}
                onCancel={() => setEditing(null)}
                onSubmit={async (patch) => {
                  await patchEntry(row.id, patch);
                  setEditing(null);
                }}
              />
            ) : (
              <EntrySummary
                row={row}
                onEdit={() => setEditing(row.id)}
                onToggleStatus={() =>
                  patchEntry(row.id, {
                    status: row.status === "live" ? "draft" : "live",
                  })
                }
                onDelete={async () => {
                  if (
                    !(await confirm({
                      title: `Delete "${row.title}"?`,
                      confirmLabel: "Delete",
                      destructive: true,
                    }))
                  )
                    return;
                  await deleteEntry(row.id);
                }}
              />
            )}
          </div>
        ))}
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
      {confirmDialog}
    </div>
  );
}

function normaliseRow(r: ChangelogRow): ChangelogRow {
  return {
    ...r,
    publishedAt: r.publishedAt ? toIso(r.publishedAt) : null,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

function toIso(v: string | Date): string {
  return typeof v === "string" ? v : v.toISOString();
}

function EntrySummary({
  row,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  row: ChangelogRow;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const isLive = row.status === "live";
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
          <span style={typeTag(row.type)}>{TYPE_LABELS[row.type]}</span>
          <span style={statusTag(row.status)}>{row.status}</span>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{row.title}</h3>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono, monospace)" }}>
          {row.slug}
          {row.publishedAt && ` · published ${formatDate(row.publishedAt)}`}
        </div>
        {row.body && (
          <pre
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              color: "var(--muted)",
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              maxHeight: 80,
              overflow: "hidden",
            }}
          >
            {row.body.slice(0, 240)}
            {row.body.length > 240 ? "…" : ""}
          </pre>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <button type="button" className="btn" style={smallBtn} onClick={onToggleStatus}>
          {isLive ? "Unpublish" : "Publish"}
        </button>
        <button type="button" className="btn" style={smallBtn} onClick={onEdit}>
          Edit
        </button>
        <button
          type="button"
          className="btn"
          style={{ ...smallBtn, color: "#f85149" }}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function AddEntryForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: { title: string; type: ChangelogType; body: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ChangelogType>("feature");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        try {
          await onSubmit({ title: title.trim(), type, body });
          setTitle("");
          setBody("");
          setType("feature");
        } catch {
          /* toast shown */
        } finally {
          setBusy(false);
        }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          autoFocus
          style={{ ...input, flex: "1 1 240px", minWidth: 160 }}
        />
        <select value={type} onChange={(e) => setType(e.target.value as ChangelogType)} style={input}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <textarea
        placeholder="Body (markdown)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        style={{ ...input, resize: "vertical", fontFamily: "var(--mono, monospace)", fontSize: 12 }}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <button type="submit" className="btn" style={smallBtn} disabled={busy || !title.trim()}>
          {busy ? "…" : "Create draft"}
        </button>
        <button type="button" className="btn" style={smallBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditEntryForm({
  row,
  onCancel,
  onSubmit,
}: {
  row: ChangelogRow;
  onCancel: () => void;
  onSubmit: (
    patch: Pick<ChangelogRow, "title" | "type" | "body" | "slug">,
  ) => Promise<void>;
}) {
  const [title, setTitle] = useState(row.title);
  const [type, setType] = useState<ChangelogType>(row.type);
  const [body, setBody] = useState(row.body);
  const [slug, setSlug] = useState(row.slug);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim() || !slug.trim()) return;
        setBusy(true);
        try {
          await onSubmit({ title: title.trim(), type, body, slug: slug.trim() });
        } finally {
          setBusy(false);
        }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="Title"
          style={{ ...input, flex: "1 1 240px", minWidth: 160 }}
        />
        <select value={type} onChange={(e) => setType(e.target.value as ChangelogType)} style={input}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <input
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        required
        placeholder="slug"
        style={{ ...input, fontFamily: "var(--mono, monospace)" }}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={10}
        placeholder="Body (markdown)"
        style={{ ...input, resize: "vertical", fontFamily: "var(--mono, monospace)", fontSize: 12 }}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <button type="submit" className="btn" style={smallBtn} disabled={busy}>
          {busy ? "…" : "Save"}
        </button>
        <button type="button" className="btn" style={smallBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

const smallBtn: React.CSSProperties = { fontSize: 11, padding: "2px 8px" };
const input: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  border: "1px solid var(--line)",
  borderRadius: 3,
  background: "var(--card)",
  color: "var(--ink)",
};

function typeTag(t: ChangelogType): React.CSSProperties {
  const colors: Record<ChangelogType, string> = {
    feature: "#2da44e",
    fix: "#bf3989",
    content: "#0969da",
    note: "#656d76",
  };
  return {
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 6px",
    background: colors[t],
    color: "#fff",
    borderRadius: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  };
}

function statusTag(s: ChangelogStatus): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 6px",
    border: "1px solid var(--line)",
    color: s === "live" ? "var(--ink)" : "var(--muted)",
    borderRadius: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  };
}
