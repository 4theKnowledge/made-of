/**
 * Combine theme metadata + membership helpers.
 *
 * Membership (which items appear in which theme) lives in Postgres on the
 * item_combine_themes join table, exposed on each GraphNode as
 * `combineThemes: string[]`. Display meta (label, description, age pool)
 * is now DB-driven too — this file just provides the shaping helpers and
 * sensible defaults so a newly-added theme works out of the box without
 * a code change.
 *
 * Safety net: `isCombineExcluded` is a first-class item column. When true,
 * the item is treated as if it weren't in any theme even if the join table
 * says otherwise. The admin theme validator flags that contradiction.
 */

import type { GraphNode } from "../graph/types";
import type { ThemeKey, ThemeMeta } from "./types";
import { DEFAULT_THEME } from "./types";

/** Baseline age pool used when a theme doesn't provide its own. Roman
 *  numerals I–XXX are enough headroom for any theme Combine will ship.
 *  `buildThemeBundle` slices this down to the derived `numAges`. */
const DEFAULT_AGE_POOL: string[] = [
  "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
  "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
  "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX", "XXX",
];

/** Per-theme age-label overrides. Any theme not listed uses the default
 *  numeral pool, which works fine for most themes. Add an override only
 *  when you want thematic labels (e.g. "Prehistoric", "Industrial"). */
const AGE_POOL_OVERRIDES: Record<string, string[]> = {
  // `everything` historically used roman numerals too — included here for
  // clarity. If this record stays empty in the future, delete the helper
  // branch and just return DEFAULT_AGE_POOL.
};

/** Open-ended age-label pool for a theme. `buildThemeBundle` slices this to
 *  the derived `numAges` and puts the slice on the active `ThemeMeta.ages`. */
export function themeAgePool(theme: ThemeKey): string[] {
  return AGE_POOL_OVERRIDES[theme] ?? DEFAULT_AGE_POOL;
}

/** Build a baseline ThemeMeta for a theme. Used when the DB hasn't
 *  supplied a custom label/description, or when runtime code needs a quick
 *  meta for a theme it only knows by code (tests, legacy paths). Prefer
 *  `themeMetaFromRow()` when you have the DB row. */
export function defaultThemeMeta(code: ThemeKey): ThemeMeta {
  return {
    k: code,
    name: code === DEFAULT_THEME ? "Everything" : code.replace(/^./, (c) => c.toUpperCase()),
    desc: code === DEFAULT_THEME
      ? "The whole map: atoms, stars, life, food, factories, machines."
      : "",
    ages: themeAgePool(code),
    collectionVersion: 0,
  };
}

/** Construct a ThemeMeta from a combine_themes row. */
export function themeMetaFromRow(row: {
  code: string;
  label: string;
  description: string | null;
  collectionVersion?: number | null;
}): ThemeMeta {
  return {
    k: row.code,
    name: row.label,
    desc: row.description ?? "",
    ages: themeAgePool(row.code),
    collectionVersion: row.collectionVersion ?? 0,
  };
}

/** Backwards-compatible lookup. Was `const THEMES: Record<ThemeKey,
 *  ThemeMeta>`; now a getter so we don't need every theme at module-load
 *  time. Returns a sensible default for unknown codes so legacy call sites
 *  (tests, scripts) keep working. */
export const THEMES: Record<string, ThemeMeta> = new Proxy(
  {} as Record<string, ThemeMeta>,
  {
    get(_, code: string) {
      return defaultThemeMeta(code);
    },
    has() {
      return true;
    },
  },
);

/** Never dealt or made in Combine (fab chain, big bang). Safety net — the
 *  join table is the source of truth for theme membership. Reads the
 *  first-class column on the node; the previous `combine-exclude` tag was
 *  migrated into this field by drizzle/0021. */
export function isCombineExcluded(node: GraphNode): boolean {
  return node.isCombineExcluded;
}

/** True when the node belongs to the given Combine theme. Enforces the
 *  "exclude trumps membership" rule so a stray exclude tag can't leak into
 *  the game via the join table. */
export function inCombineTheme(node: GraphNode, theme: ThemeKey): boolean {
  if (isCombineExcluded(node)) return false;
  return node.combineThemes.includes(theme);
}
