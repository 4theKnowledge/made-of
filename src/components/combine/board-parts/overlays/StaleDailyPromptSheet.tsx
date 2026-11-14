import React from "react";
import { ResponsiveSheet } from "@/components/common/ResponsiveSheet";

/**
 * Prompt shown on mount when the server reports an active daily Combine
 * run with a `dailyKey` strictly before today (T-0333). The player chose
 * neither to finish nor to abandon when they left — give them agency:
 *
 *  - **Save**: write a progress row from the stored state, dated to the
 *    original `dailyKey`. Ranks on that day's leaderboard via the
 *    existing manifestFound → turns → duration → score sort.
 *  - **Discard**: just end the run; nothing banked.
 *  - **Dismiss** (scrim / Escape): defer the choice; the prompt re-fires
 *    on next mount until the player picks one.
 *
 * The planning notes left "Keep playing" as a stretch option. Not
 * shipping in v1 — if players ask, it can be added by unblocking the
 * client's date-gate for the stale run's key.
 */
export function StaleDailyPromptSheet({
  dailyKey,
  score,
  manifestFound,
  manifestSize,
  busy,
  onSave,
  onDiscard,
  onDismiss,
}: {
  dailyKey: string;
  score: number;
  manifestFound: number;
  manifestSize: number;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onDismiss: () => void;
}) {
  const manifestLabel =
    manifestSize > 0 ? `${manifestFound} of ${manifestSize} items` : null;
  return (
    <ResponsiveSheet
      open
      onDismiss={busy ? () => {} : onDismiss}
      ariaLabel={`Unfinished daily from ${dailyKey}`}
    >
      <h3 style={{ margin: "4px 0 0 0", fontSize: 18 }}>
        Yesterday&rsquo;s puzzle is still open
      </h3>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
        You left the <strong>{dailyKey}</strong> daily mid-run
        {manifestLabel ? (
          <>
            {" "}
            with {manifestLabel} and {score} pts.
          </>
        ) : (
          <> with {score} pts.</>
        )}{" "}
        Save it to that day&rsquo;s leaderboard, or discard it?
      </p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          width: "100%",
          marginTop: 4,
        }}
      >
        <button
          type="button"
          className="btn"
          onClick={onSave}
          disabled={busy}
        >
          Save score
        </button>
        <button
          type="button"
          className="btn"
          onClick={onDiscard}
          disabled={busy}
          style={{
            background: "var(--bad)",
            borderColor: "var(--bad)",
            color: "var(--bg)",
          }}
        >
          Discard
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={onDismiss}
          disabled={busy}
        >
          Decide later
        </button>
      </div>
    </ResponsiveSheet>
  );
}
