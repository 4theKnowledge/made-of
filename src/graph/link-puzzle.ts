import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { LiveSnapshot } from "./live";
import {
  freeplayPar,
  generatePuzzle,
  todayKeyUtc,
} from "./link";
import { isValidCode } from "./codes";

/**
 * Puzzle reference as sent by the client. Either a date (daily, default) or
 * a {start, goal} pair of item codes (free play). The server resolves this to
 * concrete item ids, never trusting the client's view of the puzzle beyond
 * these inputs.
 */
export interface PuzzleRefBody {
  date?: string;
  free?: { start: string; goal: string };
}

export interface ResolvedPuzzle {
  startId: string;
  goalId: string;
  par: number;
}

export type ResolveError =
  | { ok: false; status: 400; error: "bad_request" }
  | { ok: false; status: 404; error: "no_puzzle" }
  | { ok: false; status: 422; error: "no_path" };

export type ResolveResult =
  | ({ ok: true } & ResolvedPuzzle)
  | ResolveError;

/**
 * Resolve a puzzle ref from a request body into a concrete {startId, goalId}.
 *
 * Daily mode: look up today's row in `daily_puzzles`, or generate on the fly
 * (same behaviour as the home page).
 *
 * Free play: validate both codes, then check a path exists using the
 * established/strong confidence filter. Reject unsolvable pairs with 422.
 * The answer path is never returned — only its length (par).
 */
export async function resolvePuzzle(
  live: LiveSnapshot,
  body: PuzzleRefBody | null | undefined,
): Promise<ResolveResult> {
  if (body?.free) {
    const { start, goal } = body.free;
    if (!isValidCode(start) || !isValidCode(goal)) {
      return { ok: false, status: 400, error: "bad_request" };
    }
    const startNode = live.nodeByCode(start);
    const goalNode = live.nodeByCode(goal);
    if (!startNode || !goalNode) {
      return { ok: false, status: 404, error: "no_puzzle" };
    }
    const par = freeplayPar(
      live.snapshot,
      startNode.id,
      goalNode.id,
      live.closed,
    );
    if (par === null) {
      return { ok: false, status: 422, error: "no_path" };
    }
    return { ok: true, startId: startNode.id, goalId: goalNode.id, par };
  }

  const date = body?.date ?? todayKeyUtc();
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dailyPuzzles)
    .where(eq(schema.dailyPuzzles.date, date))
    .limit(1);
  if (row) {
    return {
      ok: true,
      startId: row.startItemId,
      goalId: row.goalItemId,
      par: row.par,
    };
  }
  const gen = generatePuzzle(live.snapshot, live.closed, date);
  return { ok: true, startId: gen.startId, goalId: gen.goalId, par: gen.par };
}
