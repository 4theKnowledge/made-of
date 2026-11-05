"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ButtonGroup } from "@/components/common/ButtonGroup";

export type ErrorFallbackVariant = "page" | "region";

export function ErrorFallback({
  error,
  reset,
  variant = "page",
  title,
  description,
  homeHref = "/",
  homeLabel = "Go home",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  variant?: ErrorFallbackVariant;
  title?: string;
  description?: string;
  homeHref?: string;
  homeLabel?: string;
}) {
  useEffect(() => {
    // Analytics: wire into the typed track() helper once PostHog lands (see docs/POSTHOG.md).
    // For now log to console so dev sees it and prod ships it to the browser console only.
    console.error("[error-boundary]", {
      variant,
      digest: error.digest,
      message: error.message,
    });
  }, [error, variant]);

  const isDev = process.env.NODE_ENV !== "production";
  const heading = title ?? "Something broke.";
  const body =
    description ??
    "A render error knocked this part out. Try again — if it keeps happening, head home and pick another thread.";

  if (variant === "region") {
    return (
      <div className="feat" role="alert" aria-live="polite">
        <h3>{heading}</h3>
        <p>{body}</p>
        {isDev && error.message && (
          <pre
            className="small"
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "var(--mono)",
              color: "var(--muted)",
              margin: 0,
            }}
          >
            {error.message}
            {error.digest ? `\ndigest: ${error.digest}` : ""}
          </pre>
        )}
        <ButtonGroup size="tight" align="start">
          <button type="button" className="btn primary" onClick={reset}>
            Try again
          </button>
          <Link href={homeHref} className="btn">
            {homeLabel}
          </Link>
        </ButtonGroup>
      </div>
    );
  }

  return (
    <main className="wrap">
      <section className="phero">
        <span className="eyebrow">Error</span>
        <h2>{heading}</h2>
        <p>{body}</p>
      </section>

      {isDev && error.message && (
        <section className="feat">
          <h3>Details (dev only)</h3>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "var(--mono)",
              fontSize: 13,
              color: "var(--muted)",
              margin: 0,
            }}
          >
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
        </section>
      )}

      <section className="feat">
        <h3>What now?</h3>
        <ButtonGroup size="tight" align="start">
          <button type="button" className="btn primary" onClick={reset}>
            Try again
          </button>
          <Link href={homeHref} className="btn">
            {homeLabel}
          </Link>
        </ButtonGroup>
      </section>
    </main>
  );
}
