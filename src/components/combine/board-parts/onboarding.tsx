"use client";

import React, { useEffect, useState } from "react";

export const ONBOARD_CHAPTERS = [
  {
    title: "Combine to score",
    body: "Drop a tile next to a match and watch them fuse into something new. Every combine scores and discovers a real recipe.",
  },
  {
    title: "Chain for big points",
    body: "When a new tile lands next to another match, it chains into a second combine. Chains multiply your score.",
  },
  {
    title: "Collect every recipe",
    body: "Every new combine lands in your collection. Fill the book to trace life, the planet, and everything back to the big bang.",
  },
  {
    title: "Progress through ages",
    body: "Combines fill the age bar. Old tiles crumble if you stall — keep moving.",
  },
] as const;

export function OnboardingDemo({ onDismiss }: { onDismiss: () => void }) {
  const [step, setStep] = useState(0);
  const [restartKey, setRestartKey] = useState(0);
  // Auto-advance only while the player is passively watching. Any
  // manual interaction (dot, Replay, Next) signals they want to drive
  // the sequence themselves — stop auto-advancing for the rest of this
  // viewing.
  const [autoAdvance, setAutoAdvance] = useState(true);
  useEffect(() => {
    if (!autoAdvance) return;
    const id = window.setTimeout(() => {
      setStep((s) => {
        if (s >= ONBOARD_CHAPTERS.length - 1) return s;
        return s + 1;
      });
    }, 4200);
    return () => window.clearTimeout(id);
  }, [step, restartKey, autoAdvance]);
  const chapter = ONBOARD_CHAPTERS[step];
  const isLast = step === ONBOARD_CHAPTERS.length - 1;
  return (
    <div className="cbscrim" role="dialog" aria-modal="true" onClick={onDismiss}>
      <div className="cbonboard" onClick={(e) => e.stopPropagation()}>
        <h2>{chapter.title}</h2>
        <div className="cbonboard-stage-wrap">
          <div
            className={`cbonboard-stage cbonboard-stage-${step}`}
            key={`${step}-${restartKey}`}
            aria-hidden="true"
          >
            {step === 0 && <OnboardStageCombine />}
            {step === 1 && <OnboardStageChain />}
            {step === 2 && <OnboardStageCollection />}
            {step === 3 && <OnboardStageAges />}
          </div>
        </div>
        <p>{chapter.body}</p>
        <div className="cbonboard-dots" role="tablist">
          {ONBOARD_CHAPTERS.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`cbonboard-dot${i === step ? " on" : ""}`}
              aria-label={`Go to step ${i + 1}`}
              aria-selected={i === step}
              onClick={() => {
                setAutoAdvance(false);
                setStep(i);
                setRestartKey((k) => k + 1);
              }}
            />
          ))}
        </div>
        <div className="cbonboard-actions">
          {!isLast && (
            <button
              type="button"
              className="cbonboard-skip"
              onClick={onDismiss}
            >
              Skip
            </button>
          )}
          <button
            type="button"
            className="cbonboard-skip"
            onClick={() => {
              // Replay resumes auto-advance — the user is signalling
              // 'show me the whole thing again, hands-off'.
              setAutoAdvance(true);
              setStep(0);
              setRestartKey((k) => k + 1);
            }}
            aria-label="Replay from start"
          >
            Replay
          </button>
          <button
            type="button"
            className="cbonboard-go"
            onClick={() => {
              if (isLast) onDismiss();
              else {
                setAutoAdvance(false);
                setStep((s) => s + 1);
                setRestartKey((k) => k + 1);
              }
            }}
          >
            {isLast ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Inline copies of the onboarding pictograms, using the same
// `.b` / `.l` / `.k` class system as the live Pictogram so they match
// the game's visual language. One narrative threads all four chapters:
//   rock + water → clay → +kiln → brick.
// The .ic wrapper picks up the shared `.ic svg .b/.l/.k` rules from globals.css.
const PICTO_ROCK = (
  <span className="ic">
    <svg viewBox="0 0 32 32">
      <path className="b" d="M4 25l3-10 7-6 8 1 6 9-2 6z" />
      <path className="l" d="M10 17l5 2 4-3" />
    </svg>
  </span>
);
const PICTO_WATER = (
  <span className="ic">
    <svg viewBox="0 0 32 32">
      <path className="b" d="M16 3c5 7 9 11.5 9 16.5a9 9 0 0 1-18 0C7 14.5 11 10 16 3z" />
      <path className="l" d="M11.5 20a4.5 4.5 0 0 0 3 4" />
    </svg>
  </span>
);
const PICTO_CLAY = (
  <span className="ic">
    <svg viewBox="0 0 32 32">
      <path className="b" d="M10 5h12l-2 4c5 2 7 6 7 10 0 6-5 9-11 9S5 25 5 19c0-4 2-8 7-10z" />
      <path className="l" d="M10 9h12" />
    </svg>
  </span>
);
const PICTO_KILN = (
  <span className="ic">
    <svg viewBox="0 0 32 32">
      <path className="l" d="M16 8V3" />
      <path className="b" d="M4 28c0-12 5-20 12-20s12 8 12 20z" />
      <path className="l" d="M11 28v-6a5 5 0 0 1 10 0v6" />
    </svg>
  </span>
);
const PICTO_BRICK = (
  <span className="ic">
    <svg viewBox="0 0 32 32">
      <rect className="b" x="3" y="7" width="26" height="18" />
      <path className="l" d="M3 13h26M3 19h26M10 7v6M20 7v6M15 13v6M25 13v6M8 19v6M20 19v6" />
    </svg>
  </span>
);

function OnboardStageCombine() {
  return (
    <>
      <span className="cbob-tile cbob-a">{PICTO_ROCK}<em className="cbob-lbl">rock</em></span>
      <span className="cbob-tile cbob-b">{PICTO_WATER}<em className="cbob-lbl">water</em></span>
      <span className="cbob-tile cbob-c">{PICTO_CLAY}<em className="cbob-lbl">clay</em></span>
      <span className="cbob-score">+30</span>
      <span className="cbob-new">New!</span>
    </>
  );
}

function OnboardStageChain() {
  // Real 2-step chain from the KB:
  //   rock + water → clay
  //   clay + kiln  → brick
  // Each stage fuses in place; the ×2 chain chip blooms on the second step.
  return (
    <>
      <span className="cbob-tile cbob-ch-a">{PICTO_ROCK}<em className="cbob-lbl">rock</em></span>
      <span className="cbob-tile cbob-ch-b">{PICTO_WATER}<em className="cbob-lbl">water</em></span>
      <span className="cbob-tile cbob-ch-c">{PICTO_CLAY}<em className="cbob-lbl">clay</em></span>
      <span className="cbob-tile cbob-ch-d">{PICTO_KILN}<em className="cbob-lbl">kiln</em></span>
      <span className="cbob-tile cbob-ch-e">{PICTO_BRICK}<em className="cbob-lbl">brick</em></span>
      <span className="cbob-mult">×2 chain</span>
    </>
  );
}

function OnboardStageCollection() {
  // Shows the clay recipe landing in a mini collection book slot with a
  // "Recipe collected" flourish. Keeps the clay narrative threading
  // through all four chapters.
  return (
    <>
      <span className="cbob-recipe">
        <span className="cbob-mini">{PICTO_ROCK}</span>
        <i className="cbob-plus">+</i>
        <span className="cbob-mini">{PICTO_WATER}</span>
        <i className="cbob-eq">=</i>
        <span className="cbob-mini cbob-mini-out">{PICTO_CLAY}</span>
      </span>
      <div className="cbob-book" aria-hidden="true">
        <span className="cbob-book-slot cbob-book-slot-fill">{PICTO_CLAY}</span>
        <span className="cbob-book-slot" />
        <span className="cbob-book-slot" />
        <span className="cbob-book-slot" />
      </div>
      <span className="cbob-count" aria-hidden="true">
        <span className="cbob-count-current">
          <b className="cbob-count-n cbob-count-n-0">0</b>
          <b className="cbob-count-n cbob-count-n-1">1</b>
        </span>
        <span className="cbob-count-sep">/</span>
        <span className="cbob-count-total">400+</span>
      </span>
      <span className="cbob-collect">Recipe collected</span>
    </>
  );
}

function OnboardStageAges() {
  return (
    <>
      <span className="cbob-tile cbob-age-tile">
        {PICTO_ROCK}
        <em className="cbob-lbl">rock</em>
        <b className="cbob-age-counter cbob-age-counter-3">3</b>
        <b className="cbob-age-counter cbob-age-counter-2">2</b>
        <b className="cbob-age-counter cbob-age-counter-1">1</b>
      </span>
      <div className="cbob-bar" aria-hidden="true">
        <span className="cbob-bar-fill" />
      </div>
      <span className="cbob-age-label">Age I → Age II</span>
    </>
  );
}

export function GlyphDrag() {
  return (
    <span className="mc" aria-hidden="true">
      <span className="bd">
        <span className="cl" />
        <span className="cl tgt anim-target" />
        <span className="cl full" />
        <span className="cl" />
      </span>
      <span className="tr">
        <span className="mt sm M anim-fly">
          <span className="d" />
        </span>
        <span className="mt sm P">
          <span className="d" />
        </span>
        <span className="mt sm S">
          <span className="d" />
        </span>
      </span>
    </span>
  );
}

export function GlyphCombine() {
  return (
    <span className="mc" aria-hidden="true">
      <span className="bd">
        <span className="cl full anim-fuse" />
        <span className="cl full anim-fuse" style={{ animationDelay: ".2s" }} />
        <span className="cl" />
        <span className="cl" />
      </span>
      <span className="tr">
        <span className="mt sm C anim-rise">
          <span className="d" />
        </span>
      </span>
    </span>
  );
}

export function GlyphShelf() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "flex",
        gap: 5,
        padding: "0 6px 5px",
        borderBottom: "2px solid var(--ink)",
        alignItems: "flex-end",
      }}
    >
      <span className="mt sm M anim-rise">
        <span className="d" />
      </span>
      <span className="mt md P anim-rise" style={{ animationDelay: ".25s" }}>
        <span className="d" />
      </span>
      <span className="mt sm S anim-rise" style={{ animationDelay: ".5s" }}>
        <span className="d" />
      </span>
    </span>
  );
}

export function GlyphGlow() {
  return (
    <span className="mc" aria-hidden="true">
      <span className="bd">
        <span className="cl full anim-glow" />
        <span className="cl" />
        <span className="cl" />
        <span className="cl full anim-glow" style={{ animationDelay: ".7s" }} />
      </span>
    </span>
  );
}

export function GlyphCrumble() {
  return (
    <span className="mc" aria-hidden="true">
      <span className="bd">
        <span className="cl full anim-crumble">
          <span className="crk anim-tick">3</span>
        </span>
        <span className="cl" />
        <span className="cl" />
        <span className="cl full" />
      </span>
    </span>
  );
}

export function GlyphAges() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 58,
        height: 12,
        border: "1.5px solid var(--ink)",
        borderRadius: 2,
        background: "var(--surface)",
        overflow: "hidden",
        boxShadow: "1.5px 1.5px 0 var(--ink)",
        position: "relative",
      }}
    >
      <i
        className="anim-fill"
        style={{
          display: "block",
          height: "100%",
          width: "20%",
          background: "var(--accent)",
        }}
      />
    </span>
  );
}
