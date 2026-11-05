import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Footer } from "@/components/common/Footer";
import { Header } from "@/components/common/Header";
import { getLiveSnapshot } from "@/graph/live";
import {
  generatePuzzle,
  todayKeyUtc,
  dayNumber,
} from "@/graph/link";
import { getDb, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { getExploreView } from "@/graph/explore";
import { LinkBoard } from "@/components/link/LinkBoard";
import { FreePlayShell } from "@/components/link/FreePlayShell";
import type { DailyPuzzle } from "@/components/link/types";

type LinkMode = "daily" | "free";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Link · Made Of",
  description:
    "A daily puzzle, or free play: link a start thing to a goal thing by following what each is made of.",
  alternates: { canonical: "/link" },
};

// Link mode is paused — route 404s publicly while the code stays intact.
// See docs/REVIVING-LINK-CRAFT.md to bring it back.
const PAUSED = true;

export default async function LinkPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (PAUSED) notFound();
  const { mode: modeParam } = await searchParams;
  const mode: LinkMode = modeParam === "free" ? "free" : "daily";

  if (mode === "free") {
    return (
      <main className="wrap">
        <Header current="link" />
        <FreePlayShell />
        <Footer />
      </main>
    );
  }

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
    ref: { kind: "daily", date: puzzleRaw.date },
    start: {
      code: live.itemCodes.toCode(start.slug)!,
      name: start.name,
      tier: start.tier,
      kind: start.kind,
      symbol: start.symbol,
    },
    goal: {
      code: live.itemCodes.toCode(goal.slug)!,
      name: goal.name,
      tier: goal.tier,
      kind: goal.kind,
      symbol: goal.symbol,
    },
  };

  const initialView = await getExploreView(start.slug, { includeCanary: true });
  if (!initialView) throw new Error("Daily start item has no view");

  return (
    <main className="wrap">
      <Header current="link" exploreHref={`/explore/${start.slug}`} />
      <LinkBoard puzzle={puzzle} initialView={initialView} />
      <Footer />
    </main>
  );
}
