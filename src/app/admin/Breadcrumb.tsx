import Link from "next/link";
import type { ReactNode } from "react";

export interface Crumb {
  label: ReactNode;
  href?: string;
}

/**
 * Admin breadcrumb trail. Last item has no href and is styled as the
 * current page. Uses the project's mono eyebrow treatment so it reads as
 * navigation chrome rather than content.
 */
export function Breadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        fontFamily: "var(--mono, monospace)",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--muted)",
        marginBottom: 10,
      }}
    >
      {trail.map((c, i) => {
        const last = i === trail.length - 1;
        return (
          <span key={i}>
            {c.href && !last ? (
              <Link href={c.href} style={{ color: "var(--muted)", textDecoration: "none" }}>
                {c.label}
              </Link>
            ) : (
              <span style={last ? { color: "var(--ink)" } : undefined}>{c.label}</span>
            )}
            {!last && <span style={{ padding: "0 8px" }}>›</span>}
          </span>
        );
      })}
    </nav>
  );
}
