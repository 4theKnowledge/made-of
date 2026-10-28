import Link from "next/link";
import { getLiveSnapshot } from "@/graph/live";
import {
  generatePuzzle,
  todayKeyUtc,
  dayNumber,
} from "@/graph/daily";
import { getDb, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { DailyBoard } from "@/components/daily/DailyBoard";
import type { DailyNeighbour, DailyPuzzle } from "@/components/daily/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const live = await getLiveSnapshot();
  const date = todayKeyUtc();
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dailyPuzzles)
    .where(eq(schema.dailyPuzzles.date, date))
    .limit(1);
  const puzzleRaw = row
    ? {
        date: row.date,
        n: dayNumber(row.date),
        startId: row.startItemId,
        goalId: row.goalItemId,
        par: row.par,
      }
    : generatePuzzle(live.snapshot, live.closed, date);

  const start = live.snapshot.nodes.get(puzzleRaw.startId)!;
  const goal = live.snapshot.nodes.get(puzzleRaw.goalId)!;

  const puzzle: DailyPuzzle = {
    date: puzzleRaw.date,
    number: puzzleRaw.n,
    par: puzzleRaw.par,
    start: {
      code: live.itemCodes.toCode(start.id)!,
      name: start.name,
      tier: start.tier,
      kind: start.kind,
      symbol: start.symbol,
    },
    goal: {
      code: live.itemCodes.toCode(goal.id)!,
      name: goal.name,
      tier: goal.tier,
      kind: goal.kind,
      symbol: goal.symbol,
    },
  };

  const startNeighbours: DailyNeighbour[] = start.neighbours.map((nbId) => {
    const nb = live.snapshot.nodes.get(nbId)!;
    return {
      code: live.itemCodes.toCode(nbId)!,
      name: nb.name,
      tier: nb.tier,
      kind: nb.kind,
      symbol: nb.symbol,
      closed: live.closed.has(nbId),
      isGoal: nbId === puzzleRaw.goalId,
    };
  });

  return (
    <main className="wrap">
      <header>
        <div className="brand">
          <h1>Made Of</h1>
          <span>Everything is made of something.</span>
        </div>
        <nav className="tabs" aria-label="Modes">
          <Link href="/" className="on">
            Daily link
          </Link>
          <Link href={`/explore/${start.id}`}>Explore</Link>
          <Link href="/scratch">From scratch</Link>
        </nav>
      </header>

      <DailyBoard puzzle={puzzle} startNeighbours={startNeighbours} />

      <p className="msg nudge" style={{ textAlign: "center" }}>
        Want to see what anything is made of?{" "}
        <Link href={`/explore/${start.id}`}>Explore the map →</Link>
      </p>
    </main>
  );
}
