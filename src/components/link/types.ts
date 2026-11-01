import type { ItemKind, Tier } from "@/db/schema";

export interface DailyItem {
  code: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  symbol: string | null;
}

export interface DailyNeighbour extends DailyItem {
  closed: boolean;
  isGoal: boolean;
}

export type PuzzleRef =
  | { kind: "daily"; date: string }
  | { kind: "free"; start: string; goal: string };

export interface DailyPuzzle {
  date: string;
  number: number;
  start: DailyItem;
  goal: DailyItem;
  par: number;
  /** How the client identifies this puzzle to the server. */
  ref: PuzzleRef;
}

export type MoveDelta = "closer" | "same" | "further";

export interface MoveResponse {
  ok: boolean;
  reason?: "closed" | "not_adjacent";
  name?: string;
  done?: boolean;
  delta?: MoveDelta;
  arrived?: DailyItem;
  neighbours?: DailyNeighbour[];
}

export interface PathStep {
  code: string;
  name: string;
}

export interface GameState {
  /** Steps along the path; path[0] is start. */
  path: PathStep[];
  /** Deltas array; deltas[i] is for the move from path[i] to path[i+1]. */
  deltas: MoveDelta[];
  /** Every item code ever hinted at (so the counter persists across moves). */
  hintCodes: string[];
  /** Only the most recent hint — only this chip glows (prototype P.lastHint). */
  lastHintCode: string | null;
  gaveUp: boolean;
  done: boolean;
}

export const EMPTY_GAME: GameState = {
  path: [],
  deltas: [],
  hintCodes: [],
  lastHintCode: null,
  gaveUp: false,
  done: false,
};
