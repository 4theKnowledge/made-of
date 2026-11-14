import React from "react";
import Link from "next/link";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";
import { ThemeToggleRow } from "@/components/common/ThemeToggle";

export function MoreButton({
  moreOpen,
  soundOn,
  signedIn,
  isAdmin,
  canEndRun,
  onToggleMore,
  onBook,
  onSound,
  onDebug,
  onHelp,
  onIntro,
  onFeedback,
  onEndRun,
}: {
  moreOpen: boolean;
  soundOn: boolean;
  signedIn: boolean;
  isAdmin: boolean;
  canEndRun?: boolean;
  onToggleMore: () => void;
  onBook: () => void;
  onSound: () => void;
  onDebug?: () => void;
  onHelp: () => void;
  onIntro: () => void;
  onFeedback: () => void;
  onEndRun?: () => void;
}) {
  return (
    <div className="cbmorewrap">
      <button
        type="button"
        id="cbMore"
        className={`cbsnd${moreOpen ? " on" : ""}`}
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        aria-label="More"
        title="More"
        onClick={onToggleMore}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <ResponsiveSheet
        open={moreOpen}
        onDismiss={onToggleMore}
        ariaLabel="More"
        className="cbmoremenu cbhelpmenu"
      >
        <span className="k cbhelptitle">More</span>
        <Link
          href="/"
          className="cbhm"
          aria-label="Back to home"
          onClick={onToggleMore}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" />
          </svg>
          <span className="nm">
            <b className="t">Home</b>
          </span>
        </Link>
        <button
          type="button"
          className="cbhm"
          onClick={onBook}
          aria-label="Open collection"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5c3-1 6-1 8 1v14c-2-2-5-2-8-1zM20 5c-3-1-6-1-8 1v14c2-2 5-2 8-1z" />
          </svg>
          <span className="nm">
            <b className="t">Collection</b>
          </span>
        </button>
        <button
          type="button"
          className="cbhm"
          onClick={onSound}
          aria-label="Music and sound settings"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9h4l5-4v14l-5-4H4z" />
            {soundOn ? (
              <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
            ) : (
              <path d="M17 9l5 6M22 9l-5 6" />
            )}
          </svg>
          <span className="nm">
            <b className="t">Music &amp; sound</b>
          </span>
        </button>
        <ThemeToggleRow showSubtitle={false} />
        {onDebug && isAdmin && (
          <button
            type="button"
            className="cbhm"
            onClick={onDebug}
            aria-label="Admin debug panel"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 3h4v6l5 11a3 3 0 0 1-3 4H8a3 3 0 0 1-3-4l5-11V3H6z" />
              <path d="M9 3h6" />
            </svg>
            <span className="nm">
              <b className="t">Debug</b>
            </span>
          </button>
        )}
        <button
          type="button"
          className="cbhm"
          onClick={onHelp}
          aria-label="How to play"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.3 9.2a2.7 2.7 0 1 1 4.2 2.4c-1 .6-1.5 1.2-1.5 2.4" />
            <circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none" />
          </svg>
          <span className="nm">
            <b className="t">How to play</b>
          </span>
        </button>
        <button
          type="button"
          className="cbhm"
          onClick={onIntro}
          aria-label="Replay tutorial"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
          <span className="nm">
            <b className="t">Replay tutorial</b>
          </span>
        </button>
        {onEndRun && (
          <button
            type="button"
            className="cbhm"
            onClick={onEndRun}
            disabled={!canEndRun}
            aria-label="End run and bank score"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 4h4v16H5zM13 4l7 8-7 8z" />
            </svg>
            <span className="nm">
              <b className="t">End run</b>
            </span>
          </button>
        )}
        <button
          type="button"
          className="cbhm"
          onClick={onFeedback}
          aria-label="Send feedback"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5h16v11H8l-4 4z" />
          </svg>
          <span className="nm">
            <b className="t">Send feedback</b>
          </span>
        </button>
        {isAdmin && (
          <Link
            href="/admin"
            className="cbhm"
            aria-label="Open admin"
            onClick={onToggleMore}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3l9 4-9 4-9-4 9-4zM3 11l9 4 9-4M3 15l9 4 9-4" />
            </svg>
            <span className="nm">
              <b className="t">Admin</b>
            </span>
          </Link>
        )}
        <Link
          href={signedIn ? "/account" : "/sign-in"}
          className="cbhm"
          aria-label={signedIn ? "Account" : "Sign in"}
          onClick={onToggleMore}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
          </svg>
          <span className="nm">
            <b className="t">{signedIn ? "Account" : "Sign in"}</b>
          </span>
        </Link>
      </ResponsiveSheet>
    </div>
  );
}
