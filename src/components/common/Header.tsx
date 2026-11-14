"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { AuthNavLink } from "./AuthNavLink";
import { ThemeToggle } from "./ThemeToggle";

type Current =
  | "home"
  | "combine"
  | "link"
  | "craft"
  | "explore"
  | "directory"
  | "leaderboard"
  | "pricing"
  | "about"
  | "account";

function buildLinks(
  exploreHref: string,
): Array<{ href: string; label: string; key: Current }> {
  return [
    { href: "/", label: "Home", key: "home" },
    { href: "/combine", label: "Combine", key: "combine" },
    { href: "/leaderboard", label: "Leaderboard", key: "leaderboard" },
    { href: exploreHref, label: "Explore", key: "explore" },
    { href: "/directory", label: "Directory", key: "directory" },
    { href: "/pricing", label: "Pricing", key: "pricing" },
    { href: "/about", label: "About", key: "about" },
  ];
}

export function Header({
  current,
  exploreHref = "/explore/water",
  compact = false,
}: {
  current?: Current;
  exploreHref?: string;
  /** Compact header for game pages: hides the brand subtitle and tightens
   *  vertical rhythm so the play surface sits closer to the top of the
   *  viewport. Nav remains intact. */
  compact?: boolean;
}) {
  const links = buildLinks(exploreHref);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const drawerId = useId();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header className={compact ? "compact" : undefined}>
      <div className="brand">
        <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
          <h1>Made Of</h1>
        </Link>
        {!compact && <span>Everything is made of something.</span>}
      </div>
      <nav className="tabs" aria-label="Modes">
        {links.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            className={current === l.key ? "on" : ""}
          >
            {l.label}
          </Link>
        ))}
        <AuthNavLink />
        <ThemeToggle />
      </nav>
      <button
        type="button"
        className="navToggle"
        aria-expanded={open}
        aria-controls={drawerId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`navToggleBars ${open ? "open" : ""}`} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      <div
        className={`navDrawer ${open ? "open" : ""}`}
        id={drawerId}
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        hidden={!open}
      >
        <nav className="navDrawerList" aria-label="Modes">
          {links.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              className={current === l.key ? "on" : ""}
            >
              {l.label}
            </Link>
          ))}
          <AuthNavLink />
          <ThemeToggle />
        </nav>
      </div>
      {open && (
        <div
          className="navBackdrop"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
    </header>
  );
}
