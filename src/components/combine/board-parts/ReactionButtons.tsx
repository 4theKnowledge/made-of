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
  labels = false,
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
  /** When true, render a short word next to each icon ("Good" / "Issue" /
   *  "Report") so the buttons are self-explanatory in surfaces with room
   *  to breathe (DetailCard). Icon-only variant stays default for compact
   *  surfaces (DiscoveryToast). */
  labels?: boolean;
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

  const groupClass = `cbrx${size === "xs" ? " xs" : ""}${labels ? " labeled" : ""}`;
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
          {labels && <span className="cbrx-lab">Good</span>}
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
          {labels && <span className="cbrx-lab">Issue</span>}
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
            {labels && <span className="cbrx-lab">Report</span>}
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

/* Icon glyphs for the reaction buttons. Drawn in the pictogram vocabulary
 * so dark-mode contrast and tier-pastel highlight styles come free:
 *   .b — solid filled body (with --pk stroke)
 *   .l — stroke-only accent line (no fill)
 *   .k — solid filled accent
 * These three glyphs lean on .b (big silhouette) + a single .l detail,
 * matching the weight of Star/Hydrogen/etc. so they fit the same tiles. */

/* Icon glyphs for the reaction buttons. Rendered in the pictogram
 * vocabulary (`.b` = filled body with --pk stroke, `.l` = stroke-only
 * accent) so dark-mode contrast and tier highlights come free. Each
 * silhouette is a single closed path — rejects, cuff squares, and
 * joint details were fighting the pictogram's thick-stroke aesthetic
 * at small sizes. One shape per glyph keeps them readable at 16px. */

function ThumbsUpIcon() {
  return (
    <span className="ic" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path
          className="b"
          d="M4 14 H10 V28 H4 Z M10 14 H16 L20 4 Q23 4 23 7 V12 H28 Q30 12 30 14 L28 26 Q27.5 28 25 28 H10 Z"
        />
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
          d="M4 4 H10 V18 H4 Z M10 4 H25 Q27.5 4 28 6 L30 18 Q30 20 28 20 H23 V25 Q23 28 20 28 L16 18 H10 Z"
        />
      </svg>
    </span>
  );
}

function FlagIcon() {
  return (
    <span className="ic" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path className="b" d="M5 4 H9 V29 H5 Z M9 4 H26 L22 10 L26 16 H9 Z" />
      </svg>
    </span>
  );
}
