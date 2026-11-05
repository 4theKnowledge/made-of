import React, { useState } from "react";
import type { ReactionTarget, ReactionState } from "@/combine/useReactions";

/** Up / down / report grouped primitive. Used by DiscoveryToast, DetailCard,
 *  and CollectionBook rows.
 *
 *  Downvote is quiet: the vote records immediately; after a downvote fires
 *  (either in this render or carried in via `state.mine === -1`), an inline
 *  "Tell us why?" chip appears. Clicking it calls `onReport()`, which the
 *  parent uses to open the feedback sheet prefilled with recipe/item context.
 *
 *  Signed-out players get the same shell but the thumbs trigger `onSignInNeeded`
 *  instead of a vote; Report still works (anonymous feedback is allowed). */
export function ReactionButtons({
  target,
  state,
  onVote,
  onReport,
  onSignInNeeded,
  authed,
  size = "md",
}: {
  target: ReactionTarget;
  state: ReactionState | undefined;
  onVote: (value: -1 | 0 | 1, reason?: string) => void;
  onReport?: () => void;
  /** Called when a signed-out user taps a thumb. Typically navigates to
   *  `/sign-in`. If omitted, thumbs are disabled for signed-out users. */
  onSignInNeeded?: () => void;
  authed: boolean;
  size?: "md" | "xs";
}) {
  const mine = state?.mine ?? null;
  // Local hint: has the player just downvoted in this render? Keeps the
  // "Tell us why?" chip visible between a downvote and either (a) a
  // report submission or (b) a subsequent change of mind.
  const [showWhy, setShowWhy] = useState(false);

  const handle = (value: -1 | 0 | 1) => {
    if (!authed) {
      onSignInNeeded?.();
      return;
    }
    onVote(value);
    if (value === -1) setShowWhy(true);
    else setShowWhy(false);
  };

  const groupClass = `cbrx${size === "xs" ? " xs" : ""}`;
  const labelFor = target === "recipe" ? "this recipe" : "this item";

  return (
    <div className={groupClass} role="group" aria-label={`React to ${labelFor}`}>
      <div className="cbrx-row">
        <button
          type="button"
          className={`cbrx-btn${mine === 1 ? " on up" : ""}`}
          onClick={() => handle(mine === 1 ? 0 : 1)}
          aria-pressed={mine === 1}
          aria-label={`Thumbs up for ${labelFor}`}
          title="Thumbs up"
        >
          <ThumbsUpIcon />
        </button>
        <button
          type="button"
          className={`cbrx-btn${mine === -1 ? " on down" : ""}`}
          onClick={() => handle(mine === -1 ? 0 : -1)}
          aria-pressed={mine === -1}
          aria-label={`Thumbs down for ${labelFor}`}
          title="Thumbs down"
        >
          <ThumbsDownIcon />
        </button>
        {onReport && (
          <button
            type="button"
            className="cbrx-btn flag"
            onClick={() => {
              setShowWhy(false);
              onReport();
            }}
            aria-label={`Report ${labelFor}`}
            title="Report"
          >
            <FlagIcon />
          </button>
        )}
      </div>
      {(showWhy || mine === -1) && onReport && (
        <button
          type="button"
          className="cbrx-why"
          onClick={() => {
            setShowWhy(false);
            onReport();
          }}
        >
          Tell us why?
        </button>
      )}
    </div>
  );
}

function ThumbsUpIcon() {
  return (
    <span className="ic" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path
          className="b"
          d="M11 14l5-9c2 0 3 1.4 3 3.2V13h7c1.7 0 3 1.3 3 3l-1.5 10c-.3 1.7-1.8 3-3.5 3H11z"
        />
        <path className="l" d="M3 14h5v14H3z" />
      </svg>
    </span>
  );
}

function ThumbsDownIcon() {
  return (
    <span className="ic" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path
          className="b"
          d="M21 18l-5 9c-2 0-3-1.4-3-3.2V19H6c-1.7 0-3-1.3-3-3l1.5-10C4.8 4.3 6.3 3 8 3h13z"
        />
        <path className="l" d="M29 4h-5v14h5z" />
      </svg>
    </span>
  );
}

function FlagIcon() {
  return (
    <span className="ic" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path className="l" d="M7 4v24" />
        <path className="b" d="M7 5h18l-4 6 4 6H7z" />
      </svg>
    </span>
  );
}
