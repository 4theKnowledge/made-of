"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { AuthNavLink } from "./AuthNavLink";

type Current =
  | "daily"
  | "explore"
  | "scratch"
  | "combine"
  | "pricing"
  | "about"
  | "account";

const LINKS: Array<{ href: string; label: string; key: Current }> = [
  { href: "/", label: "Daily link", key: "daily" },
  { href: "/explore/water", label: "Explore", key: "explore" },
  { href: "/scratch", label: "From scratch", key: "scratch" },
  { href: "/combine", label: "Combine", key: "combine" },
  { href: "/pricing", label: "Pricing", key: "pricing" },
  { href: "/about", label: "About", key: "about" },
];

export function Header({ current }: { current?: Current }) {
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
    <header>
      <div className="brand">
        <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
          <h1>Made Of</h1>
        </Link>
        <span>Everything is made of something.</span>
      </div>
      <nav className="tabs" aria-label="Modes">
        {LINKS.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            className={current === l.key ? "on" : ""}
          >
            {l.label}
          </Link>
        ))}
        <AuthNavLink />
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
          {LINKS.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              className={current === l.key ? "on" : ""}
            >
              {l.label}
            </Link>
          ))}
          <AuthNavLink />
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
