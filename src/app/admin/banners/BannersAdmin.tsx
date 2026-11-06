"use client";

import { useCallback, useRef, useState } from "react";
import type {
  SiteBannerAudience,
  SiteBannerSeverity,
  SiteBannerStatus,
} from "@/db/schema";

export interface BannerRow {
  id: string;
  body: string;
  severity: SiteBannerSeverity;
  status: SiteBannerStatus;
  audience: SiteBannerAudience;
  dismissible: boolean;
  startsAt: string | null;
  endsAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const SEVERITIES: SiteBannerSeverity[] = ["info", "warn", "critical"];
const AUDIENCES: SiteBannerAudience[] = [
  "everyone",
  "signed_in",
  "signed_out",
  "admins_only",
];
const AUDIENCE_LABELS: Record<SiteBannerAudience, string> = {
  everyone: "Everyone",
  signed_in: "Signed-in users",
  signed_out: "Signed-out visitors",
  admins_only: "Admins only",
};
const SEVERITY_LABELS: Record<SiteBannerSeverity, string> = {
  info: "Info",
  warn: "Warn",
  critical: "Critical",
};

type Patchable = Partial<
  Pick<
    BannerRow,
    | "body"
    | "severity"
    | "audience"
    | "dismissible"
    | "status"
    | "startsAt"
    | "endsAt"
  >
>;

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
  create: (body: {
    body: string;
    severity: SiteBannerSeverity;
    audience: SiteBannerAudience;
    dismissible: boolean;
    startsAt: string | null;
    endsAt: string | null;
  }) =>
    send<{ banner: BannerRow }>("/api/admin/banners", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patch: (id: string, patch: Patchable) =>
    send<{ banner: BannerRow }>(`/api/admin/banners/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  del: (id: string) =>
    send<{ ok: true }>(`/api/admin/banners/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};

interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
}

export function BannersAdmin({ initial }: { initial: BannerRow[] }) {
  const [rows, setRows] = useState<BannerRow[]>(initial);
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
      optimistic: (prev: BannerRow[]) => BannerRow[],
      request: () => Promise<T>,
      onSuccess?: (result: T, applied: BannerRow[]) => BannerRow[] | void,
      errorPrefix = "Request failed",
    ) => {
      let previous: BannerRow[] | null = null;
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

  const createBanner = useCallback(
    async (input: Parameters<typeof api.create>[0]) => {
      const now = new Date().toISOString();
      const optimisticId = `tmp-${Date.now()}`;
      const optimistic: BannerRow = {
        id: optimisticId,
        body: input.body,
        severity: input.severity,
        status: "draft",
        audience: input.audience,
        dismissible: input.dismissible,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await mutate(
        (prev) => [optimistic, ...prev],
        () => api.create(input),
        (result, applied) =>
          applied.map((r) =>
            r.id === optimisticId ? normaliseRow(result.banner) : r,
          ),
        "Create failed",
      );
    },
    [mutate],
  );

  const patchBanner = useCallback(
    async (id: string, patch: Patchable) => {
      // Publishing auto-archives whichever other banner was previously live.
      // Mirror that locally so the UI doesn't briefly show two live rows.
      const willBeLive = patch.status === "live";
      await mutate(
        (prev) =>
          prev.map((r) => {
            if (r.id === id)
              return { ...r, ...patch, updatedAt: new Date().toISOString() };
            if (willBeLive && r.status === "live")
              return { ...r, status: "archived" as const };
            return r;
          }),
        () => api.patch(id, patch),
        (result, applied) =>
          applied.map((r) => (r.id === id ? normaliseRow(result.banner) : r)),
        "Update failed",
      );
    },
    [mutate],
  );

  const deleteBanner = useCallback(
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
            + New banner
          </button>
        ) : (
          <AddBannerForm
            onCancel={() => setShowAdd(false)}
            onSubmit={async (input) => {
              await createBanner(input);
              setShowAdd(false);
            }}
          />
        )}
      </div>

      <div>
        {rows.length === 0 && (
          <p style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>
            No banners yet. Create one to get started.
          </p>
        )}
        {rows.map((row) => (
          <div
            key={row.id}
            style={{ borderBottom: "1px solid var(--line)", padding: "12px 14px" }}
          >
            {editing === row.id ? (
              <EditBannerForm
                row={row}
                onCancel={() => setEditing(null)}
                onSubmit={async (patch) => {
                  await patchBanner(row.id, patch);
                  setEditing(null);
                }}
              />
            ) : (
              <BannerSummary
                row={row}
                onEdit={() => setEditing(row.id)}
                onPublish={() => patchBanner(row.id, { status: "live" })}
                onUnpublish={() => patchBanner(row.id, { status: "archived" })}
                onDelete={async () => {
                  if (!confirm(`Delete this banner?`)) return;
                  await deleteBanner(row.id);
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
    </div>
  );
}

function normaliseRow(r: BannerRow): BannerRow {
  return {
    ...r,
    startsAt: r.startsAt ? toIso(r.startsAt) : null,
    endsAt: r.endsAt ? toIso(r.endsAt) : null,
    publishedAt: r.publishedAt ? toIso(r.publishedAt) : null,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

function toIso(v: string | Date): string {
  return typeof v === "string" ? v : v.toISOString();
}

function BannerSummary({
  row,
  onEdit,
  onPublish,
  onUnpublish,
  onDelete,
}: {
  row: BannerRow;
  onEdit: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
}) {
  const isLive = row.status === "live";
  const canPublish = row.status === "draft" || row.status === "archived";
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
          <span style={severityTag(row.severity)}>{SEVERITY_LABELS[row.severity]}</span>
          <span style={statusTag(row.status)}>{row.status}</span>
          <span style={audienceTag}>{AUDIENCE_LABELS[row.audience]}</span>
          {!row.dismissible && <span style={audienceTag}>Not dismissible</span>}
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 14, whiteSpace: "pre-wrap" }}>
          {row.body}
        </p>
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "var(--muted)",
            fontFamily: "var(--mono, monospace)",
          }}
        >
          {row.publishedAt && `published ${formatDate(row.publishedAt)}`}
          {row.startsAt && ` · starts ${formatDate(row.startsAt)}`}
          {row.endsAt && ` · ends ${formatDate(row.endsAt)}`}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {isLive ? (
          <button type="button" className="btn" style={smallBtn} onClick={onUnpublish}>
            Unpublish
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            style={smallBtn}
            onClick={onPublish}
            disabled={!canPublish}
          >
            Publish
          </button>
        )}
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

function AddBannerForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: Parameters<typeof api.create>[0]) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<SiteBannerSeverity>("info");
  const [audience, setAudience] = useState<SiteBannerAudience>("everyone");
  const [dismissible, setDismissible] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        setBusy(true);
        try {
          await onSubmit({
            body: body.trim(),
            severity,
            audience,
            dismissible,
            startsAt: localToIso(startsAt),
            endsAt: localToIso(endsAt),
          });
          setBody("");
          setSeverity("info");
          setAudience("everyone");
          setDismissible(true);
          setStartsAt("");
          setEndsAt("");
        } catch {
          /* toast shown */
        } finally {
          setBusy(false);
        }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <textarea
        placeholder="Banner text"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        required
        autoFocus
        style={{ ...input, resize: "vertical", fontSize: 13 }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={field}>
          <span style={fieldLabel}>Severity</span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as SiteBannerSeverity)}
            style={input}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label style={field}>
          <span style={fieldLabel}>Audience</span>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as SiteBannerAudience)}
            style={input}
          >
            {AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...field, flexDirection: "row", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={dismissible}
            onChange={(e) => setDismissible(e.target.checked)}
          />
          <span style={fieldLabel}>Dismissible</span>
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={field}>
          <span style={fieldLabel}>Starts at (optional)</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            style={input}
          />
        </label>
        <label style={field}>
          <span style={fieldLabel}>Ends at (optional)</span>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            style={input}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="submit" className="btn" style={smallBtn} disabled={busy || !body.trim()}>
          {busy ? "…" : "Create draft"}
        </button>
        <button type="button" className="btn" style={smallBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditBannerForm({
  row,
  onCancel,
  onSubmit,
}: {
  row: BannerRow;
  onCancel: () => void;
  onSubmit: (patch: Patchable) => Promise<void>;
}) {
  const [body, setBody] = useState(row.body);
  const [severity, setSeverity] = useState<SiteBannerSeverity>(row.severity);
  const [audience, setAudience] = useState<SiteBannerAudience>(row.audience);
  const [dismissible, setDismissible] = useState(row.dismissible);
  const [startsAt, setStartsAt] = useState(isoToLocal(row.startsAt));
  const [endsAt, setEndsAt] = useState(isoToLocal(row.endsAt));
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        setBusy(true);
        try {
          await onSubmit({
            body: body.trim(),
            severity,
            audience,
            dismissible,
            startsAt: localToIso(startsAt),
            endsAt: localToIso(endsAt),
          });
        } finally {
          setBusy(false);
        }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        required
        style={{ ...input, resize: "vertical", fontSize: 13 }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={field}>
          <span style={fieldLabel}>Severity</span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as SiteBannerSeverity)}
            style={input}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label style={field}>
          <span style={fieldLabel}>Audience</span>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as SiteBannerAudience)}
            style={input}
          >
            {AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...field, flexDirection: "row", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={dismissible}
            onChange={(e) => setDismissible(e.target.checked)}
          />
          <span style={fieldLabel}>Dismissible</span>
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={field}>
          <span style={fieldLabel}>Starts at (optional)</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            style={input}
          />
        </label>
        <label style={field}>
          <span style={fieldLabel}>Ends at (optional)</span>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            style={input}
          />
        </label>
      </div>
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

function localToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
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
const field: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  fontSize: 11,
};
const fieldLabel: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

function severityTag(s: SiteBannerSeverity): React.CSSProperties {
  const colors: Record<SiteBannerSeverity, string> = {
    info: "#0969da",
    warn: "#bf8700",
    critical: "#c0392b",
  };
  return {
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 6px",
    background: colors[s],
    color: "#fff",
    borderRadius: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  };
}

function statusTag(s: SiteBannerStatus): React.CSSProperties {
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

const audienceTag: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  padding: "1px 6px",
  border: "1px solid var(--line)",
  color: "var(--muted)",
  borderRadius: 3,
};
