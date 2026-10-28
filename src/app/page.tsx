import Link from "next/link";
import { getLiveSnapshot } from "@/graph/live";
import {
  generatePuzzle,
  todayKeyUtc,
  dayNumber,
} from "@/graph/daily";
import { getDb, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { getExploreView } from "@/graph/explore";
import { DailyBoard } from "@/components/daily/DailyBoard";
import type { DailyPuzzle } from "@/components/daily/types";

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

  const initialView = await getExploreView(start.id, { includeCanary: true });
  if (!initialView) throw new Error("Daily start item has no view");

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

      <DailyBoard puzzle={puzzle} initialView={initialView} />
    </main>
  );
}
