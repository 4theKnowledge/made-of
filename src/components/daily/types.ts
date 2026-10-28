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

export interface DailyPuzzle {
  date: string;
  number: number;
  start: DailyItem;
  goal: DailyItem;
  par: number;
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

export interface GameState {
  /** Codes along the path; path[0] is start. */
  path: string[];
  /** Deltas array; deltas[i] is for the move from path[i] to path[i+1]. */
  deltas: MoveDelta[];
  hintCodes: string[];
  gaveUp: boolean;
  done: boolean;
}

export const EMPTY_GAME: GameState = {
  path: [],
  deltas: [],
  hintCodes: [],
  gaveUp: false,
  done: false,
};
