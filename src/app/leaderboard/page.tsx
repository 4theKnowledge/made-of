import type { Metadata } from "next";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getSession } from "@/lib/session";
import { getDailyPayload } from "@/combine/daily-schedule-db";
import { todayKey } from "@/combine/rng";
import { prevDay } from "@/combine/daily-schedule";
import { DailyLeaderboard } from "./DailyLeaderboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboard · Made Of",
  description:
    "Top players on today's Daily Combine. See who finished fastest and how you compare.",
  alternates: { canonical: "/leaderboard" },
  openGraph: {
    title: "Leaderboard · Made Of",
    description:
      "Top players on today's Daily Combine. See who finished fastest and how you compare.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Leaderboard · Made Of",
    description:
      "Top players on today's Daily Combine. See who finished fastest and how you compare.",
  },
};

export default async function LeaderboardPage() {
  const today = todayKey();
  const theme = "everything" as const;

  // Pre-resolve `targetDiscoveries` for the 7 visible days so the UI can
  // render `X / N` without a second round-trip per day. Past-day rows
  // without a payload (pre-feature) resolve to null and render without
  // a divisor.
  const days: string[] = [];
  let cursor = today;
  for (let i = 0; i < 7; i++) {
    days.push(cursor);
    cursor = prevDay(cursor);
  }
  // If the daily tables haven't been created yet (fresh env) or the query
  // fails for any reason, degrade gracefully — the leaderboard still works,
  // just without `/target` divisors.
  const payloadEntries = await Promise.all(
    days.map(async (d) => {
      try {
        const payload = await getDailyPayload(theme, d);
        return [d, payload?.targetDiscoveries ?? null] as const;
      } catch {
        return [d, null] as const;
      }
    }),
  );
  const targetByDay: Record<string, number | null> = Object.fromEntries(payloadEntries);

  const session = await getSession();
  const currentUserHandle =
    (session?.user as { handle?: string | null } | undefined)?.handle ?? null;

  return (
    <main className="wrap">
      <Header current="leaderboard" />
      <div className="pricing">
        <section className="phero">
          <span className="eyebrow">Leaderboard</span>
          <h2>Who&apos;s on top.</h2>
          <p>
            Today&apos;s best players in Daily Combine. Fewest turns to the target wins.
          </p>
        </section>
        <DailyLeaderboard
          theme={theme}
          today={today}
          days={days}
          targetByDay={targetByDay}
          currentUserHandle={currentUserHandle}
        />
      </div>
      <Footer compactOnMobile />
    </main>
  );
}
