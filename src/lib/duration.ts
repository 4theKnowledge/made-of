/** Compact human-readable duration — `4s`, `23s`, `1m 23s`, `12m 05s`,
 *  `1h 02m 30s`. Zero-unit prefixes are dropped (no "0m 4s"). When a
 *  larger unit is present the smaller units pad to 2 so columns align:
 *  "1m 05s", not "1m 5s". Rounds down to the nearest second — the daily
 *  clock is ms-precise for tie-breaks, but UI rounds so "1m 23.456s"
 *  doesn't flicker. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}h ${mins.toString().padStart(2, "0")}m ${secs
      .toString()
      .padStart(2, "0")}s`;
  }
  if (mins > 0) {
    return `${mins}m ${secs.toString().padStart(2, "0")}s`;
  }
  return `${secs}s`;
}
