import { useEffect, useState } from "react";

function msUntilNextUtcMidnight(now: Date = new Date()): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(0, next - now.getTime());
}

function format(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function NextDailyCountdown({
  prefix = "Next daily in",
}: {
  prefix?: string;
}) {
  const [ms, setMs] = useState(() => msUntilNextUtcMidnight());

  useEffect(() => {
    const id = window.setInterval(
      () => setMs(msUntilNextUtcMidnight()),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="cbnextdaily">
      {prefix} {format(ms)}
    </span>
  );
}
