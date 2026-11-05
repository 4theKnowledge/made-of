"use client";

import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  const isDev = process.env.NODE_ENV !== "production";

  return (
    <html lang="en">
      <body>
        <main className="wrap">
          <section className="phero">
            <span className="eyebrow">Error</span>
            <h2>The page couldn&rsquo;t load.</h2>
            <p>
              Something went wrong at the top level. Try reloading — if it
              sticks, come back in a moment.
            </p>
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
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn primary"
                onClick={reset}
              >
                Try again
              </button>
              <a href="/" className="btn">
                Go home
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
