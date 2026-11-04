import Link from "next/link";
import type { AccountStats } from "@/lib/stats/load";

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function fmtTime(ms: number): string {
  if (ms <= 0) return "—";
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--mono, 'Chivo Mono'), ui-monospace, monospace", fontSize: 22, lineHeight: 1.1, marginTop: 4 }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );
}

export function StatsPanel({ stats }: { stats: AccountStats }) {
  const { craft, combine } = stats;

  const nothingYet =
    craft.totalSolves === 0 &&
    combine.totalDiscovered === 0 &&
    combine.totalRuns === 0;
  if (nothingYet) {
    return (
      <p style={{ color: "var(--muted)", margin: 0 }}>
        No stats yet. Play <Link href="/scratch">From scratch</Link> or{" "}
        <Link href="/combine">Combine</Link> and your personal bests will show up here.
      </p>
    );
  }

  const bestEntries = Object.entries(craft.bestByTarget)
    .sort((a, b) => b[1].bestScore - a[1].bestScore)
    .slice(0, 5);

  const themeEntries = Object.entries(combine.bestByTheme).sort(
    (a, b) => b[1].bestScore - a[1].bestScore,
  );
  const fastThemeEntries = Object.entries(combine.bestByFastTheme).sort(
    (a, b) => b[1].bestScore - a[1].bestScore,
  );

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <h4 style={{ margin: "0 0 10px", fontSize: 14, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>
          From scratch
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 16 }}>
          <Stat label="Best score" value={String(craft.bestScore)} hint={`out of 1000`} />
          <Stat label="Total score" value={craft.totalScore.toLocaleString()} />
          <Stat label="Solves" value={String(craft.totalSolves)} />
          <Stat label="Unique targets" value={String(craft.uniqueTargets)} />
          <Stat label="At or under par" value={String(craft.atOrUnderPar)} />
          <Stat label="Three-star solves" value={String(craft.threeStarSolves)} />
        </div>
        {bestEntries.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>
              Personal bests
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
              {bestEntries.map(([slug, best]) => (
                <li key={slug} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}>
                  <a href={`/i/${slug}`} style={{ color: "var(--ink)" }}>
                    {slug.replace(/-/g, " ")}
                  </a>
                  <span style={{ color: "var(--muted)", fontFamily: "var(--mono, 'Chivo Mono'), monospace", fontSize: 13 }}>
                    {best.bestScore} pts · {best.bestMoves} moves · {fmtTime(best.bestTimeMs)} · {"★".repeat(best.bestStars)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <h4 style={{ margin: "0 0 10px", fontSize: 14, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>
          Combine
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 16 }}>
          <Stat label="Best score" value={combine.bestScoreEver.toLocaleString()} hint={combine.totalRuns > 0 ? `across ${combine.totalRuns} runs` : "no runs yet"} />
          <Stat label="Total score" value={combine.totalScoreEver.toLocaleString()} />
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 16, marginTop: 16 }}>
          <Stat
            label="Endless collection"
            value={String(combine.byScope.endless.total)}
            hint="shared across endless themes"
          />
          <Stat
            label="Daily collection"
            value={String(combine.byScope.daily.total)}
            hint="daily puzzle only"
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 16, marginTop: 16 }}>
          <Stat label="Fundamental" value={String(combine.byTier.F)} />
          <Stat label="Natural" value={String(combine.byTier.N)} />
          <Stat label="Material" value={String(combine.byTier.M)} />
          <Stat label="Component" value={String(combine.byTier.C)} />
          <Stat label="Product" value={String(combine.byTier.P)} />
          <Stat label="System" value={String(combine.byTier.S)} />
        </div>
      </div>
    </div>
  );
}
