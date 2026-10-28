"use client";

import { useEffect, useRef, useState } from "react";
import { REL } from "@/lib/rel";
import type { Confidence, LinkType } from "@/db/schema";

export interface EvidenceDrawerProps {
  /** When non-null, the drawer is open for this link code. */
  linkCode: string | null;
  /** Which direction the link is being viewed from (affects "x → y" phrasing). */
  direction: "up" | "down";
  /** The type of link (for the "f/w/n/s/e" relation label). */
  type: LinkType | null;
  /** Names at each end, for the pair header. */
  fromName: string | null;
  toName: string | null;
  /** Called when the drawer should close. */
  onClose: () => void;
}

interface EvidencePayload {
  evidence: Array<{
    type: string;
    stance: "supports" | "contradicts";
    summary: string;
    sources: Array<{
      id: string;
      kind: string;
      title: string;
      authors: string | null;
      year: number | null;
      published: string | null;
      url: string | null;
    }>;
  }>;
}

const CONF_INFO: Record<Confidence, { label: string; desc: string; cssVar: string }> = {
  established: {
    label: "Established",
    desc: "Textbook consensus. Very unlikely to change.",
    cssVar: "--good",
  },
  strong: {
    label: "Strong",
    desc: "Well supported, though details are still argued.",
    cssVar: "--tC",
  },
  debated: {
    label: "Debated",
    desc: "Serious competing explanations exist.",
    cssVar: "--warn",
  },
  hypothesis: {
    label: "Hypothesis",
    desc: "Plausible, but the evidence is thin.",
    cssVar: "--bad",
  },
};

export function EvidenceDrawer({
  linkCode,
  direction,
  type,
  fromName,
  toName,
  onClose,
}: EvidenceDrawerProps) {
  const [data, setData] = useState<EvidencePayload | null>(null);
  const [confidence, setConfidence] = useState<Confidence>("strong");
  const [loading, setLoading] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!linkCode) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/links/${linkCode}/evidence`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: EvidencePayload | null) => {
        if (body) setData(body);
      })
      .finally(() => setLoading(false));
  }, [linkCode]);

  useEffect(() => {
    if (!linkCode) return;
    // Focus the close button when the drawer opens.
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [linkCode, onClose]);

  if (!linkCode) return null;

  const cf = CONF_INFO[confidence];
  const relLabel = type ? REL[type][direction === "up" ? "up" : "down"] : "";

  // Collect unique sources with numbering, prototype-style.
  const sourceOrder: EvidencePayload["evidence"][number]["sources"] = [];
  if (data) {
    for (const e of data.evidence) {
      for (const s of e.sources) {
        if (!sourceOrder.some((x) => x.id === s.id)) sourceOrder.push(s);
      }
    }
  }
  const srcNum = (id: string) =>
    sourceOrder.findIndex((s) => s.id === id) + 1;

  // Try to infer confidence from the first evidence entry if we have it.
  // (The API doesn't currently return the link's confidence; we fall back
  // to "strong" and keep it in state so the user can hint it if we add
  // the field later.)
  void setConfidence;

  return (
    <>
      <div className="evbg" onClick={onClose} aria-hidden="true" />
      <aside
        className="evd"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evTitle"
      >
        <div className="evtop">
          <span className="k">Evidence for a link</span>
          <button
            ref={closeBtnRef}
            type="button"
            className="x"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="evhead">
          <h3 id="evTitle" className="pair" style={{ margin: 0 }}>
            <span className="chip">
              <span className="nm">{fromName ?? ""}</span>
            </span>
            <span className="rel">{relLabel.toLowerCase()}</span>
            <span className="chip">
              <span className="nm">{toName ?? ""}</span>
            </span>
          </h3>
        </div>

        <div
          className="conf"
          style={{ "--cc": `var(${cf.cssVar})` } as React.CSSProperties}
        >
          <span className="evb" data-c={confidence} aria-hidden="true" />
          <div>
            <b>{cf.label}</b>
            <span>{cf.desc}</span>
          </div>
        </div>

        {loading ? (
          <p className="msg">Loading…</p>
        ) : data && data.evidence.length > 0 ? (
          <>
            <h4>Evidence</h4>
            <ul className="evlist">
              {data.evidence.map((e, i) => (
                <li key={i}>
                  <span className={`stance ${e.stance}`}>
                    {e.stance === "contradicts" ? "Against" : "For"}
                  </span>
                  <span className="ty">{e.type}</span>
                  <span>
                    {e.summary}
                    {e.sources.map((s) => (
                      <sup key={s.id}>
                        <a href={`#src-${srcNum(s.id)}`}>[{srcNum(s.id)}]</a>
                      </sup>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {sourceOrder.length > 0 && (
              <>
                <h4>Sources</h4>
                <ol className="srcs">
                  {sourceOrder.map((s, i) => (
                    <li key={s.id} id={`src-${i + 1}`}>
                      {s.authors ? `${s.authors} ` : ""}
                      {s.year ? `(${s.year}) ` : ""}
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener">
                          {s.title}
                        </a>
                      ) : (
                        s.title
                      )}
                      {s.published ? (
                        <>
                          . <i>{s.published}</i>
                        </>
                      ) : null}
                      .
                    </li>
                  ))}
                </ol>
              </>
            )}
          </>
        ) : (
          <p className="msg">
            No evidence attached to this link yet.
          </p>
        )}

        <p className="prov">
          Researched by Claude from web sources. Not yet reviewed by a person.
        </p>
      </aside>
    </>
  );
}
