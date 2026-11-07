"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  TUTORIAL_STEPS,
  resolveTip,
  type TutorialStepId,
} from "@/combine/tutorial";

/**
 * Native tutorial overlay: a glowing outline around the current step's
 * target zone plus an anchored popover with the step copy. No dim scrim —
 * uses the app's warm-accent drop-shadow glow (same vocabulary as the
 * landing hero's attention cue) to pull the player's eye, so the rest of
 * the board stays fully interactive underneath. The whole overlay is
 * `pointer-events: none` except the popover's close button.
 *
 * Why native instead of a library:
 *  - The player must be able to drag tiles onto the spotlighted zone
 *    during a step. Every off-the-shelf tour library catches clicks on
 *    its scrim for dismissal; for us that was swallowing drops.
 *  - Match the app's visual vocabulary (ink border, hard shadow, Chivo)
 *    without fighting a vendor's chrome.
 */
export function TutorialOverlay({
  tutorialStep,
  lastOutName = null,
  paused = false,
  onExit,
}: {
  tutorialStep: TutorialStepId | null;
  /** Display name of the most recent combine output in the active
   *  tutorial run. Dynamic step copy (step 3) interpolates this so the
   *  popover speaks honestly when the player resolves a multi-output
   *  recipe (e.g. hydrogen + helium → sun vs star). */
  lastOutName?: string | null;
  /** True when a blocking modal is open — the overlay hides so its
   *  popover doesn't float over the modal. Resumes when paused flips
   *  back to false. */
  paused?: boolean;
  onExit: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const highlight = tutorialStep ? TUTORIAL_STEPS[tutorialStep].highlight : null;
  const tip = tutorialStep
    ? resolveTip(TUTORIAL_STEPS[tutorialStep], { lastOutName })
    : null;

  // Recompute the target rect on step change, scroll, and resize. Also
  // observe the target's own size (board + tray shift as the player
  // interacts). Falls back to a centered popover with no spotlight when
  // the target isn't found.
  useLayoutEffect(() => {
    if (!highlight || paused || !tutorialStep) {
      setRect(null);
      return;
    }
    const sel = `[data-tour="${highlight}"]`;
    const target = document.querySelector<HTMLElement>(sel);
    if (!target) {
      setRect(null);
      return;
    }
    const measure = () => setRect(target.getBoundingClientRect());
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(target);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [highlight, tutorialStep, paused]);

  if (!mounted || paused || !tutorialStep || tutorialStep === "done") return null;

  // Spotlight geometry. When there's no rect (no highlight target or
  // target missing), the popover is bottom-anchored so it's never
  // off-screen. Otherwise, position the popover below the target by
  // default, flipping above if there isn't room.
  const pad = 6;
  let popoverStyle: React.CSSProperties = {
    position: "fixed",
    left: "50%",
    bottom: 16,
    transform: "translateX(-50%)",
  };
  let spotlightStyle: React.CSSProperties | null = null;
  if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popoverEstHeight = 120; // conservative; actual height may differ
    const spaceBelow = vh - rect.bottom;
    const placeBelow = spaceBelow > popoverEstHeight + 24 || rect.top < popoverEstHeight + 24;
    const top = placeBelow ? rect.bottom + 12 : undefined;
    const bottom = placeBelow ? undefined : vh - rect.top + 12;
    // Clamp horizontal to viewport.
    const cx = Math.max(12, Math.min(vw - 12, rect.left + rect.width / 2));
    popoverStyle = {
      position: "fixed",
      left: cx,
      ...(top != null ? { top } : {}),
      ...(bottom != null ? { bottom } : {}),
      transform: "translateX(-50%)",
    };
    spotlightStyle = {
      position: "fixed",
      left: rect.left - pad,
      top: rect.top - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
      pointerEvents: "none",
    };
  }

  return createPortal(
    <div
      className="cbtut-overlay"
      aria-live="polite"
      // Container doesn't catch events — only the close button does.
      style={{ pointerEvents: "none" }}
    >
      {spotlightStyle && (
        <div className="cbtut-overlay-spotlight" style={spotlightStyle} />
      )}
      <div
        ref={popoverRef}
        className="cbtut-overlay-popover"
        role="dialog"
        aria-label="Tutorial step"
        style={popoverStyle}
      >
        <button
          type="button"
          className="cbtut-overlay-close"
          onClick={onExit}
          aria-label="Exit tutorial"
        >
          ×
        </button>
        <p className="cbtut-overlay-body">{tip}</p>
      </div>
    </div>,
    document.body,
  );
}
