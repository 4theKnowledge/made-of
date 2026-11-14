"use client";

import Link from "next/link";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";
import { DailyLeaderboard } from "@/app/leaderboard/DailyLeaderboard";

const TOP_N = 10;

/** Compact in-game preview of today's leaderboard. Opens from GameOverCard
 *  after a daily finishes. Renders the same `DailyLeaderboard` component
 *  that powers `/leaderboard` so the two surfaces stay in lock-step —
 *  only differences are the fixed day, trimmed to top N, and no day
 *  navigation or outer header (the sheet frame carries those). */
export function DailyLeaderboardModal({
  open,
  onDismiss,
  day,
  theme,
  currentUserHandle,
  manifestSize,
}: {
  open: boolean;
  onDismiss: () => void;
  day: string;
  theme: string;
  currentUserHandle: string | null;
  /** Optional — when provided, the "found" cell shows `X / N`. */
  manifestSize?: number | null;
}) {
  return (
    <ResponsiveSheet
      open={open}
      onDismiss={onDismiss}
      ariaLabel={`Leaderboard for ${day}`}
      className="cblb"
    >
      <button
        type="button"
        className="cbx"
        aria-label="Close leaderboard"
        onClick={onDismiss}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      <span className="k">Daily leaderboard</span>
      <b className="cblb-day">{day}</b>

      {open && (
        <DailyLeaderboard
          theme={theme}
          today={day}
          days={[day]}
          targetByDay={{ [day]: manifestSize ?? null }}
          currentUserHandle={currentUserHandle}
          maxRows={TOP_N}
          showDayChips={false}
          showGameChip={false}
          showMeta={false}
          variant="embed"
        />
      )}

      <Link href="/leaderboard" className="cblb-full" onClick={onDismiss}>
        View full leaderboard →
      </Link>
    </ResponsiveSheet>
  );
}
