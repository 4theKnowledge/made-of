"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { FeedbackStatus, FeedbackType } from "@/db/schema";

export interface FeedbackRow {
  id: string;
  type: FeedbackType;
  payload: Record<string, unknown>;
  userId: string | null;
  url: string | null;
  status: FeedbackStatus;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
}

const TYPE_LABELS: Record<FeedbackType, string> = {
  suggest_item: "Suggest item",
  suggest_recipe: "Suggest recipe",
  report: "Report",
  other: "Other",
};

const STATUSES: FeedbackStatus[] = ["open", "triaged", "dismissed", "resolved"];

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
    } catch {}
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

const api = {
  patch: (id: string, body: Partial<Pick<FeedbackRow, "status" | "adminNote">>) =>
    send<{ entry: FeedbackRow }>(`/api/admin/feedback/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  del: (id: string) =>
    send<{ ok: true }>(`/api/admin/feedback/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};

interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
}

export function FeedbackAdmin({ initial }: { initial: FeedbackRow[] }) {
  const [rows, setRows] = useState<FeedbackRow[]>(initial);
  const [filter, setFilter] = useState<FeedbackStatus | "all">("open");
  const [typeFilter, setTypeFilter] = useState<FeedbackType | "all">("all");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  const toast = useCallback((text: string, kind: Toast["kind"] = "error") => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const patchRow = useCallback(
    async (id: string, patch: Partial<Pick<FeedbackRow, "status" | "adminNote">>) => {
      const prev = rows;
      setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      try {
        const result = await api.patch(id, patch);
        setRows((r) => r.map((x) => (x.id === id ? normalise(result.entry) : x)));
      } catch (e) {
        setRows(prev);
        toast(`Update failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [rows, toast],
  );

  const deleteRow = useCallback(
    async (id: string) => {
      const prev = rows;
      setRows((r) => r.filter((x) => x.id !== id));
      try {
        await api.del(id);
      } catch (e) {
        setRows(prev);
        toast(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [rows, toast],
  );

  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          (filter === "all" || r.status === filter) &&
          (typeFilter === "all" || r.type === typeFilter),
      ),
    [rows, filter, typeFilter],
  );

  const openCount = rows.filter((r) => r.status === "open").length;

  return (
    <div>
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {openCount} open · {rows.length} total
        </span>
        <span style={{ fontSize: 12 }}>
          Status:{" "}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FeedbackStatus | "all")}
            style={input}
          >
            <option value="all">all</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </span>
        <span style={{ fontSize: 12 }}>
          Type:{" "}
          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as FeedbackType | "all")
            }
            style={input}
          >
            <option value="all">all</option>
            {(Object.keys(TYPE_LABELS) as FeedbackType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div>
        {visible.length === 0 && (
          <p style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>
            Nothing here. Change filters to see more.
          </p>
        )}
        {visible.map((row) => (
          <div
            key={row.id}
            style={{ borderBottom: "1px solid var(--line)", padding: "12px 14px" }}
          >
            <Row row={row} onPatch={(p) => patchRow(row.id, p)} onDelete={() => deleteRow(row.id)} />
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
    </div>
  );
}

function Row({
  row,
  onPatch,
  onDelete,
}: {
  row: FeedbackRow;
  onPatch: (patch: Partial<Pick<FeedbackRow, "status" | "adminNote">>) => void;
  onDelete: () => void;
}) {
  const [note, setNote] = useState(row.adminNote ?? "");
  const [noteDirty, setNoteDirty] = useState(false);

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 4,
            flexWrap: "wrap",
          }}
        >
          <span style={typeTag(row.type)}>{TYPE_LABELS[row.type]}</span>
          <span style={statusTag(row.status)}>{row.status}</span>
          <span
            style={{
              fontSize: 11,
              color: "var(--muted)",
              fontFamily: "var(--mono, monospace)",
            }}
          >
            {formatDate(row.createdAt)}
            {row.userId ? ` · ${row.userId.slice(0, 8)}` : " · anon"}
          </span>
        </div>
        <PayloadView row={row} />
        {row.url && (
          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              fontFamily: "var(--mono, monospace)",
              marginTop: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <a href={row.url}>{row.url}</a>
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteDirty(e.target.value !== (row.adminNote ?? ""));
            }}
            placeholder="Admin note (optional)…"
            rows={2}
            style={{
              ...input,
              width: "100%",
              resize: "vertical",
              fontFamily: "inherit",
              fontSize: 12,
            }}
          />
          {noteDirty && (
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button
                type="button"
                className="btn"
                style={smallBtn}
                onClick={() => {
                  onPatch({ adminNote: note });
                  setNoteDirty(false);
                }}
              >
                Save note
              </button>
              <button
                type="button"
                className="btn"
                style={smallBtn}
                onClick={() => {
                  setNote(row.adminNote ?? "");
                  setNoteDirty(false);
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <select
          value={row.status}
          onChange={(e) => onPatch({ status: e.target.value as FeedbackStatus })}
          style={{ ...input, fontSize: 11 }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          style={{ ...smallBtn, color: "#f85149" }}
          onClick={() => {
            if (!confirm("Delete this feedback row?")) return;
            onDelete();
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function PayloadView({ row }: { row: FeedbackRow }) {
  const p = row.payload;
  if (row.type === "suggest_item") {
    return (
      <div style={{ fontSize: 13 }}>
        <strong>{stringField(p, "name")}</strong>
        {stringField(p, "context") && (
          <div style={{ color: "var(--muted)", marginTop: 2 }}>
            {stringField(p, "context")}
          </div>
        )}
      </div>
    );
  }
  if (row.type === "suggest_recipe") {
    const inputs = Array.isArray(p.inputs) ? (p.inputs as string[]) : [];
    return (
      <div style={{ fontSize: 13 }}>
        <code>
          {inputs.join(" + ") || "—"} = {stringField(p, "output") || "?"}
        </code>
        {stringField(p, "note") && (
          <div style={{ color: "var(--muted)", marginTop: 2 }}>
            {stringField(p, "note")}
          </div>
        )}
      </div>
    );
  }
  if (row.type === "report") {
    const inputs = Array.isArray(p.recipeInputs) ? (p.recipeInputs as string[]) : null;
    return (
      <div style={{ fontSize: 13 }}>
        {inputs && (
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 12 }}>
            {inputs.join(" ")}
          </div>
        )}
        {stringField(p, "note") && (
          <div style={{ marginTop: 2 }}>{stringField(p, "note")}</div>
        )}
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            fontFamily: "var(--mono, monospace)",
            marginTop: 4,
          }}
        >
          {stringField(p, "category") && `[${stringField(p, "category")}] `}
          {stringField(p, "recipeId") && (
            <span>
              recipeId: <a href={`/admin/tree?recipe=${stringField(p, "recipeId")}`}>{stringField(p, "recipeId")}</a>{" "}
            </span>
          )}
          {stringField(p, "itemId") && (
            <span>
              itemId:{" "}
              <a href={`/admin/items/${stringField(p, "itemId")}`}>{stringField(p, "itemId")}</a>
            </span>
          )}
        </div>
      </div>
    );
  }
  return (
    <div style={{ fontSize: 13 }}>{stringField(p, "note")}</div>
  );
}

function stringField(p: Record<string, unknown>, key: string): string {
  return typeof p[key] === "string" ? (p[key] as string) : "";
}

function normalise(r: FeedbackRow): FeedbackRow {
  return {
    ...r,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(r.createdAt).toISOString(),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date(r.updatedAt).toISOString(),
  };
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
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

function typeTag(t: FeedbackType): React.CSSProperties {
  const colors: Record<FeedbackType, string> = {
    suggest_item: "#2da44e",
    suggest_recipe: "#0969da",
    report: "#bf3989",
    other: "#656d76",
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

function statusTag(s: FeedbackStatus): React.CSSProperties {
  const map: Record<FeedbackStatus, string> = {
    open: "var(--ink)",
    triaged: "var(--accent)",
    dismissed: "var(--muted)",
    resolved: "#2da44e",
  };
  return {
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 6px",
    border: `1px solid ${map[s]}`,
    color: map[s],
    borderRadius: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  };
}
