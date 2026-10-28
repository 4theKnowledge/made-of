/**
 * Display formatter for `first_appeared` dates.
 *
 * CLAUDE.md says: keep 2026 in the parser (so stored `ya` is stable), but
 * display dates against the current year in the UI. We re-run the artifact's
 * parseYear logic here with the live year as "now".
 */

const REFERENCE_NOW = () => new Date().getUTCFullYear();

const fmtN = (v: number) => String(+v.toFixed(1));

export interface DisplayedYear {
  label: string;
  short: string;
}

export function formatFirstAppeared(raw: string | null): DisplayedYear | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "?") return null;

  let circa = false;
  let y = trimmed;
  if (y[0] === "~") {
    circa = true;
    y = y.slice(1);
  }

  let label: string;
  let short: string;
  if (/bya$/.test(y)) {
    const v = parseFloat(y);
    label = `${fmtN(v)} billion years ago`;
    short = `${fmtN(v)} bn yrs ago`;
  } else if (/mya$/.test(y)) {
    const v = parseFloat(y);
    label = `${fmtN(v)} million years ago`;
    short = `${fmtN(v)} m yrs ago`;
  } else if (/ka$/.test(y)) {
    const v = parseFloat(y);
    label = `${(v * 1000).toLocaleString("en")} years ago`;
    short = `${(v * 1000).toLocaleString("en")} yrs ago`;
  } else {
    const v = parseInt(y, 10);
    if (Number.isNaN(v)) return null;
    const yearsAgo = Math.max(REFERENCE_NOW() - v, 0);
    if (v < 0) {
      label = `${(-v).toLocaleString("en")} BCE`;
    } else if (v < 1000) {
      label = `${v} CE`;
    } else {
      label = String(v);
    }
    short = label;
    // Hint at years-ago for recent-ish dates.
    if (v >= 1 && v <= REFERENCE_NOW()) {
      label = yearsAgo === 0 ? label : `${label} (${yearsAgo} yr${yearsAgo === 1 ? "" : "s"} ago)`;
    }
  }

  if (circa) {
    label = (/ago$/.test(label) ? "About " : "c. ") + label;
    short = "c. " + short;
  }
  return { label, short };
}
