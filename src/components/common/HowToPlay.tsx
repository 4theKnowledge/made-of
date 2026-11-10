"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

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
  const [idx, setIdx] = useState(0);
  const total = steps.length;
  const pointerStart = useRef<{ x: number; y: number; id: number } | null>(
    null,
  );

  const goPrev = useCallback(
    () => setIdx((i) => (i > 0 ? i - 1 : i)),
    [],
  );
  const goNext = useCallback(
    () => setIdx((i) => (i < total - 1 ? i + 1 : i)),
    [total],
  );

  useEffect(() => {
    if (!open) return;
    setIdx(0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
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
  }, [open, onClose, goNext, goPrev]);

  if (!open) return null;

  const step = steps[Math.min(idx, total - 1)];
  const atFirst = idx <= 0;
  const atLast = idx >= total - 1;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    pointerStart.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = pointerStart.current;
    pointerStart.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) goNext();
    else goPrev();
  };

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
        <h2 id={headingId} className="sr-only">
          {title}
        </h2>
        <div
          className="howto-car"
          aria-roledescription="carousel"
          aria-label="How to play steps"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            pointerStart.current = null;
          }}
        >
          <div
            key={idx}
            className="howto-slide"
            role="group"
            aria-roledescription="slide"
            aria-label={`${idx + 1} of ${total}: ${step.title}`}
          >
            <span className="howto-glyph" aria-hidden="true">
              {step.glyph}
            </span>
            <div className="howto-text">
              <b>{step.title}</b>
              <p>{step.body}</p>
            </div>
          </div>
          <div className="howto-live" aria-live="polite">
            {`Step ${idx + 1} of ${total}: ${step.title}`}
          </div>
        </div>
        <div className="howto-nav">
          <button
            type="button"
            className="howto-arr"
            aria-label="Previous step"
            onClick={goPrev}
            disabled={atFirst}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <div
            className="howto-dots"
            role="tablist"
            aria-label="Step navigation"
          >
            {steps.map((s, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === idx}
                aria-label={`Step ${i + 1}: ${s.title}`}
                className={`howto-dot ${i === idx ? "on" : ""}`}
                onClick={() => setIdx(i)}
              />
            ))}
          </div>
          <button
            type="button"
            className="howto-arr"
            aria-label="Next step"
            onClick={goNext}
            disabled={atLast}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        <span className="howto-k howto-count" aria-hidden="true">
          {idx + 1} / {total}
        </span>
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
