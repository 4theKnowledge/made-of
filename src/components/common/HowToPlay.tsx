"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export type HowToPlayStep = {
  /** A small inline SVG, pictogram or short text badge rendered in the marker tile. */
  glyph: ReactNode;
  /** Short title for the step. */
  title: string;
  /** One or two sentences explaining the step. */
  body: ReactNode;
};

export function HowToPlay({
  open,
  onClose,
  gameLabel,
  title,
  steps,
  footnote,
  ctaLabel = "Let's go",
}: {
  open: boolean;
  onClose: () => void;
  gameLabel: string;
  title: ReactNode;
  steps: HowToPlayStep[];
  footnote?: ReactNode;
  ctaLabel?: string;
}) {
  const headingId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => closeRef.current?.focus(), 20);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="howto-scrim" onClick={onClose} aria-hidden="true" />
      <section
        className="howto"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <header className="howto-hd">
          <span className="howto-k">{gameLabel} · how to play</span>
          <button
            type="button"
            className="howto-x"
            aria-label="Close"
            onClick={onClose}
            ref={closeRef}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <h2 id={headingId} className="howto-ttl">
          {title}
        </h2>
        <ol className="howto-steps">
          {steps.map((s, i) => (
            <li key={i} className="howto-step">
              <span className="howto-glyph" aria-hidden="true">
                {s.glyph}
              </span>
              <div className="howto-text">
                <b>{s.title}</b>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        {footnote ? <p className="howto-foot">{footnote}</p> : null}
        <button
          type="button"
          className="btn primary howto-cta"
          onClick={onClose}
        >
          {ctaLabel}
        </button>
      </section>
    </>
  );
}

/**
 * The ? trigger button. Match any icon button in the project (e.g. combine's
 * .cbsnd). Place next to a game's existing controls.
 */
export function HelpButton({
  onClick,
  className = "",
  label = "How to play",
}: {
  onClick: () => void;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`ibtn ${className}`.trim()}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.3 9.2a2.7 2.7 0 1 1 4.2 2.4c-1 .6-1.5 1.2-1.5 2.4" />
        <circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
}
