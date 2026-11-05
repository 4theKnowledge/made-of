"use client";

import React from "react";

type Props = {
  children: React.ReactNode;
  onReset?: () => void;
};

type State = { error: Error | null };

export class BoardErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[combine-board-error]", {
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  private handleReload = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      const isDev = process.env.NODE_ENV !== "production";
      return (
        <div
          className="feat"
          role="alert"
          aria-live="polite"
          style={{ margin: "12px 0" }}
        >
          <h3>The board crashed mid-run.</h3>
          <p>
            Something in the board hit a render error. Your lifetime
            collection is safe. Reload the page to start a fresh run.
          </p>
          {isDev && (
            <pre
              className="small"
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "var(--mono)",
                color: "var(--muted)",
                margin: 0,
              }}
            >
              {this.state.error.message}
            </pre>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
            >
              Reload run
            </button>
            <button type="button" className="btn" onClick={this.handleReload}>
              Dismiss
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
