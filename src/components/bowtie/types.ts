import type { ExploreView } from "@/components/explore/types";

export type BowtieMode = "explore" | "daily";

export interface DailyMarkers {
  /** Opaque code of the goal item; chip gets .target. */
  goalCode: string | null;
  /** Codes of items closed in puzzles; chips get .closed. */
  closedCodes: Set<string>;
  /** Codes of items currently flagged as hint; chips get .hint. */
  hintCodes: Set<string>;
}

export const EMPTY_MARKERS: DailyMarkers = {
  goalCode: null,
  closedCodes: new Set(),
  hintCodes: new Set(),
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
