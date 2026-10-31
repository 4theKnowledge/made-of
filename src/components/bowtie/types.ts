import type { ExploreView } from "@/components/explore/types";

export type BowtieMode = "explore" | "daily";

export interface DailyMarkers {
  /** Opaque code of the goal item; chip gets .target. */
  goalCode: string | null;
  /** Codes of items closed in puzzles; chips get .closed. */
  closedCodes: Set<string>;
  /**
   * The *last* hinted code — only this chip glows (prototype P.lastHint).
   * null when the user has moved on or hasn't asked for a hint yet.
   */
  lastHintCode: string | null;
}

export const EMPTY_MARKERS: DailyMarkers = {
  goalCode: null,
  closedCodes: new Set(),
  lastHintCode: null,
};

export interface BowtieViewProps {
  view: ExploreView;
  mode: BowtieMode;
  daily?: DailyMarkers;
  /**
   * Chip click handler.
   *  - Explore: not called (chips are <Link>s).
   *  - Daily: called with the target item code; the parent fires /api/daily/move.
   * The HTMLElement is the clicked chip, used for fly-ghost source rect.
   */
  onChipClick?: (targetCode: string, el: HTMLElement) => void;
}
