"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";

export type LinkMode = "daily" | "free";

/**
 * Mode switcher for Link, mirrored on Combine's ThemeMenu. The current mode
 * is highlighted; picking the other mode is a plain navigation to /link or
 * /link?mode=free so the server renders the right page.
 *
 * In free play, we also surface a "Pick different things" action that lets
 * the user reset the pair without leaving free play.
 */
export function LinkModeDialog({
  open,
  current,
  onDismiss,
  onPickFreshFreePlay,
}: {
  open: boolean;
  current: LinkMode;
  onDismiss: () => void;
  onPickFreshFreePlay?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
  }, [open]);

  return (
    <ResponsiveSheet
      open={open}
      onDismiss={onDismiss}
      ariaLabel="Choose a Link mode"
      className="cbthemes"
    >
      <span className="k">Mode</span>
      <Link
        className={`cbtopt cbdaily${current === "daily" ? " on" : ""}`}
        href="/link"
      >
        <b>Today&rsquo;s puzzle{current === "daily" ? " · playing" : ""}</b>
        <span>
          Same start and goal for everyone today. A fresh one every day.
        </span>
      </Link>
      <Link
        className={`cbtopt${current === "free" && !onPickFreshFreePlay ? " on" : ""}`}
        href="/link?mode=free"
      >
        <b>Free play{current === "free" ? " · playing" : ""}</b>
        <span>Pick any two things. Link them your way.</span>
      </Link>
      {current === "free" && onPickFreshFreePlay && (
        <button
          type="button"
          className="cbtopt"
          onClick={() => {
            onDismiss();
            onPickFreshFreePlay();
          }}
        >
          <b>Pick a new pair</b>
          <span>Reset Free play and choose different things.</span>
        </button>
      )}
      <button
        ref={closeRef}
        type="button"
        className="cbh"
        onClick={onDismiss}
        style={{ width: "100%", justifyContent: "center" }}
      >
        Cancel
      </button>
    </ResponsiveSheet>
  );
}
