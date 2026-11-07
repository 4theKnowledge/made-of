"use client";

/**
 * Theme-level settings: publish toggle + pictogram editor. Lives above the
 * ThemeBuilder on the theme detail page so these knobs are discoverable
 * without entering a modal.
 */

import { useState } from "react";
import { Pictogram } from "@/pictograms/Pictogram";

interface Props {
  themeCode: string;
  initialIsPublished: boolean;
  initialPictogram: string | null;
  memberCount: number;
}

async function patch(themeCode: string, body: Record<string, unknown>) {
  const res = await fetch(
    `/api/admin/combine-themes/${encodeURIComponent(themeCode)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    let msg = `request_failed_${res.status}`;
    try {
      const j = await res.json();
      msg = j?.message ?? j?.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

export function ThemeSettings({
  themeCode,
  initialIsPublished,
  initialPictogram,
  memberCount,
}: Props) {
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  const [pictogram, setPictogram] = useState<string>(initialPictogram ?? "");
  const [savedPictogram, setSavedPictogram] = useState<string>(initialPictogram ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const pictogramDirty = pictogram.trim() !== (savedPictogram ?? "").trim();
  const canPublish = memberCount > 0;

  const togglePublished = async () => {
    const next = !isPublished;
    if (next && !canPublish) {
      setError("Add at least one item before publishing.");
      return;
    }
    setBusy(true);
    setError(null);
    setIsPublished(next);
    try {
      await patch(themeCode, { is_published: next });
      setSavedMsg(next ? "Published — visible to players." : "Unpublished.");
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) {
      setIsPublished(!next);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const savePictogram = async () => {
    setBusy(true);
    setError(null);
    try {
      const value = pictogram.trim() || null;
      await patch(themeCode, { pictogram: value });
      setSavedPictogram(value ?? "");
      setSavedMsg("Pictogram saved.");
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="feat"
      style={{
        borderLeft: `4px solid ${isPublished ? "var(--good)" : "var(--line)"}`,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        {/* Publish toggle + status */}
        <div style={{ flex: "1 1 240px", minWidth: 240 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Visibility</h3>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 10px" }}>
            {isPublished
              ? "Shows up in the player's theme picker."
              : "Hidden from players. Admin-only draft."}
          </p>
          <button
            type="button"
            className={`btn ${isPublished ? "" : "primary"}`}
            onClick={togglePublished}
            disabled={busy || (!isPublished && !canPublish)}
            title={!canPublish ? "Add items before publishing" : undefined}
          >
            {busy
              ? "…"
              : isPublished
              ? "Unpublish"
              : canPublish
              ? "Publish to players"
              : "Needs items to publish"}
          </button>
          {!canPublish && !isPublished && (
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
              Add at least one member to this theme before publishing.
            </p>
          )}
        </div>

        {/* Pictogram editor */}
        <div style={{ flex: "2 1 360px", minWidth: 280 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Theme pictogram</h3>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 10px" }}>
            Shown on the theme tile in the player&rsquo;s picker. 32×32 SVG inner-markup
            (same style as item pictograms). Leave empty to use the default theme icon.
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div
              style={{
                border: "1.5px solid var(--ink)",
                borderRadius: 3,
                boxShadow: "2px 2px 0 var(--ink)",
                background: "var(--surface)",
                padding: 8,
              }}
            >
              <Pictogram
                name={`theme:${themeCode}`}
                tier="M"
                kind="object"
                pictogram={pictogram.trim() || null}
              />
            </div>
            <div style={{ flex: "1 1 220px", minWidth: 220 }}>
              <textarea
                value={pictogram}
                onChange={(e) => setPictogram(e.target.value)}
                placeholder={'e.g. <path class="l" d="M4 16h24"/>'}
                rows={6}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: 8,
                  fontFamily: "var(--mono, monospace)",
                  fontSize: 12,
                  border: "1px solid var(--line)",
                  borderRadius: 3,
                  background: "var(--surface)",
                  color: "var(--ink)",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  className="btn primary"
                  onClick={savePictogram}
                  disabled={busy || !pictogramDirty}
                  style={{ fontSize: 12 }}
                >
                  {busy ? "…" : pictogramDirty ? "Save pictogram" : "Saved"}
                </button>
                {pictogram && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setPictogram("")}
                    style={{ fontSize: 12 }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {(error || savedMsg) && (
        <div
          style={{
            marginTop: 12,
            padding: "6px 10px",
            borderRadius: 3,
            fontSize: 13,
            background: error ? "color-mix(in srgb, var(--bad) 10%, var(--surface))" : "color-mix(in srgb, var(--good) 10%, var(--surface))",
            color: error ? "var(--bad)" : "var(--good)",
          }}
        >
          {error ?? savedMsg}
        </div>
      )}
    </section>
  );
}
