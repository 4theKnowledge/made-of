import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getSession } from "@/lib/session";
import { loadCombineRunHistory } from "@/lib/stats/runs";
import { loadAccountStats } from "@/lib/stats/load";
import { getDb, schema } from "@/db/client";
import { inArray } from "drizzle-orm";
import { RunHistoryList } from "./RunHistoryList";
import { DailyLeaderboardCard } from "./DailyLeaderboardCard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Combine · Account · Made Of",
  description: "Your Combine history and personal bests.",
  alternates: { canonical: "/account/combine" },
  robots: { index: false },
};

// Only "everything" has a daily leaderboard today — see THEMES in
// /src/app/api/combine/daily/leaderboard/route.ts. When more themes grow
// leaderboards, remove this gate (or move it into the API).
const LEADERBOARD_THEMES = new Set(["everything"]);

export default async function AccountCombinePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const user = session.user as typeof session.user & { handle?: string | null };

  const [runs, stats] = await Promise.all([
    loadCombineRunHistory(session.user.id, 50),
    loadAccountStats(session.user.id),
  ]);

  // Build the theme-filter chip list from the themes actually present in
  // this user's history. Resolving labels requires a themes lookup — do
  // it once here rather than per-row in the client bundle.
  const presentThemeCodes = Array.from(new Set(runs.map((r) => r.theme)));
  const themeLabelRows =
    presentThemeCodes.length === 0
      ? []
      : await getDb()
          .select({
            code: schema.combineThemes.code,
            label: schema.combineThemes.label,
          })
          .from(schema.combineThemes)
          .where(inArray(schema.combineThemes.code, presentThemeCodes));
  const themeLabelMap = new Map(themeLabelRows.map((r) => [r.code, r.label]));
  const themeCodes = presentThemeCodes
    .map((code) => ({ code, label: themeLabelMap.get(code) ?? code }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Pick the most recent daily run to seed the inline leaderboard entry
  // point. Today only "everything" is leaderboarded; fall back silently
  // for runs on other themes.
  const mostRecentDaily = runs.find(
    (r) => r.mode === "daily" && r.daily !== null,
  );
  const showLeaderboard =
    mostRecentDaily !== undefined &&
    mostRecentDaily.daily !== null &&
    LEADERBOARD_THEMES.has(mostRecentDaily.theme);

  const nothingYet = runs.length === 0;

  return (
    <main className="wrap">
      <Header />
      <div className="pricing">
        <section className="phero">
          <span className="eyebrow">
            <Link href="/account" style={{ color: "inherit" }}>
              Account
            </Link>{" "}
            · Combine
          </span>
          <h2>Your Combine history</h2>
          <p>
            Your 50 most recent Combine runs, your personal bests per theme,
            and the current daily leaderboard.
          </p>
        </section>

        {nothingYet ? (
          <section className="feat">
            <p style={{ margin: 0, color: "var(--muted)" }}>
              No Combine runs yet. Play <Link href="/combine">Combine</Link>{" "}
              and finished games will land here.
            </p>
          </section>
        ) : (
          <>
            <BestsCard stats={stats.combine} />

            {showLeaderboard && mostRecentDaily && mostRecentDaily.daily && (
              <DailyLeaderboardCard
                day={mostRecentDaily.daily}
                theme={mostRecentDaily.theme}
                themeLabel={mostRecentDaily.themeLabel}
                myHandle={user.handle ?? null}
              />
            )}

            <section className="feat">
              <h3 style={{ marginTop: 0 }}>Recent runs</h3>
              <p className="small" style={{ margin: 0, marginBottom: 8 }}>
                Up to 50 most recent finished runs.
              </p>
              <RunHistoryList runs={runs} themeCodes={themeCodes} />
            </section>
          </>
        )}
      </div>
      <Footer />
    </main>
  );
}

function BestsCard({
  stats,
}: {
  stats: Awaited<ReturnType<typeof loadAccountStats>>["combine"];
}) {
  const themeEntries = Object.entries(stats.bestByTheme).sort(
    (a, b) => b[1].bestScore - a[1].bestScore,
  );
  const fastThemeEntries = Object.entries(stats.bestByFastTheme).sort(
    (a, b) => b[1].bestScore - a[1].bestScore,
  );
  return (
    <section className="feat">
      <h3 style={{ marginTop: 0 }}>Personal bests</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 16,
        }}
      >
        <Stat
          label="Best score"
          value={stats.bestScoreEver.toLocaleString()}
          hint={
            stats.totalRuns > 0
              ? `across ${stats.totalRuns} runs`
              : "no runs yet"
          }
        />
        <Stat label="Total score" value={stats.totalScoreEver.toLocaleString()} />
        {themeEntries.map(([theme, best]) => (
          <Stat
            key={theme}
            label={`Best — ${titleCase(theme)}`}
            value={best.bestScore.toLocaleString()}
          />
        ))}
        {fastThemeEntries.map(([theme, best]) => (
          <Stat
            key={`fast-${theme}`}
            label={`Best — ${titleCase(theme)} · Fast`}
            value={best.bestScore.toLocaleString()}
            hint={`${best.totalRuns} fast run${best.totalRuns === 1 ? "" : "s"}`}
          />
        ))}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--mono, 'Chivo Mono'), ui-monospace, monospace",
          fontSize: 22,
          lineHeight: 1.1,
          marginTop: 4,
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
