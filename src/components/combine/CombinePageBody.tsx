import { asc, count, eq } from "drizzle-orm";
import { getLiveSnapshot } from "@/graph/live";
import { getDb, schema } from "@/db/client";
import { Footer } from "@/components/common/Footer";
import {
  buildAllBundles,
  buildAllDailyBundles,
  buildAllFastBundles,
  buildThemeBundle,
  type GuestRecipeExtension,
} from "@/combine/data";
import { type DailyConfig } from "@/combine/daily-config";
import { getActiveDaily } from "@/combine/daily-config-db";
import { DEFAULT_THEME, type ThemeKey } from "@/combine/types";
import { serialiseBundle } from "@/combine/serialise";
import { loadAllSeasons, promoteSeason } from "@/combine/season";
import { CombineBoard } from "@/components/combine/CombineBoard";
import { getDailyPayload, resolveGuestRecipes } from "@/combine/daily-schedule-db";
import { todayKey } from "@/combine/rng";
import { getSession, isAdmin } from "@/lib/session";
import { listActiveRuns } from "@/combine/run-store";

/** Feature flag: set `COMBINE_DAILY_ENABLED=0` in env to hide the daily
 *  mode for non-admins. Admins always see daily (so they can test/reset
 *  the puzzle regardless of the flag). Any other value (including unset)
 *  leaves daily visible — this keeps the default safe. */
function dailyFlagOn(): boolean {
  return process.env.COMBINE_DAILY_ENABLED !== "0";
}

interface Props {
  /** Theme code from ?t=. When unset / unpublished / empty, falls back to
   *  the default theme so the page always renders a valid board. */
  theme?: string;
  /** Mode from ?m=. Only "fast" is honoured; other values fall through to
   *  the default endless/daily resume logic in CombineBoard. */
  mode?: string;
}

export async function CombinePageBody({ theme: themeParam, mode: modeParam }: Props = {}) {
  const live = await getLiveSnapshot();
  const prev = await loadAllSeasons();
  const db = getDb();

  // Load the published themes the player can pick from. These feed the
  // mode+theme picker and determine which bundles we need to build.
  const publishedRows = await db
    .select({
      code: schema.combineThemes.code,
      label: schema.combineThemes.label,
      description: schema.combineThemes.description,
      pictogram: schema.combineThemes.pictogram,
      collectionVersion: schema.combineThemes.collectionVersion,
    })
    .from(schema.combineThemes)
    .where(eq(schema.combineThemes.isPublished, true))
    .orderBy(asc(schema.combineThemes.position), asc(schema.combineThemes.code));

  // Drop themes with no items — they'd produce an empty board.
  const memberCounts = await db
    .select({ themeCode: schema.itemCombineThemes.themeCode, n: count() })
    .from(schema.itemCombineThemes)
    .groupBy(schema.itemCombineThemes.themeCode);
  const countByTheme = new Map(memberCounts.map((c) => [c.themeCode, c.n]));
  const publishedThemes = publishedRows
    .filter((r) => (countByTheme.get(r.code) ?? 0) > 0)
    .map((r) => ({
      code: r.code,
      label: r.label,
      description: r.description,
      pictogram: r.pictogram,
      collectionVersion: r.collectionVersion,
    }));

  // Resolve active theme: URL param wins if it's published; else default.
  const publishedCodes = new Set(publishedThemes.map((t) => t.code));
  const themeFromUrl = Boolean(themeParam && publishedCodes.has(themeParam));
  const activeTheme: ThemeKey = themeFromUrl ? (themeParam as ThemeKey) : DEFAULT_THEME;

  // Build bundles only for the active theme. Daily uses its own configured
  // host theme regardless of what the player picked.
  const activeDaily = await getActiveDaily();
  const dailyHostTheme: ThemeKey = activeDaily?.themeCode ?? DEFAULT_THEME;
  const themesToBuild = Array.from(new Set([activeTheme, dailyHostTheme]));

  const bundles = buildAllBundles(live.snapshot, prev, themesToBuild);
  for (const [theme, bundle] of Object.entries(bundles)) {
    const curr = bundle.theme.ages.length;
    if (curr > (prev[theme] ?? 0)) {
      void promoteSeason(theme, curr);
    }
  }
  const fastBundles = buildAllFastBundles(live.snapshot, themesToBuild);

  // Daily config + guest recipes live only on the daily host theme.
  const dailyConfigs: Partial<Record<string, DailyConfig | null>> = {};
  if (activeDaily) dailyConfigs[activeDaily.themeCode] = activeDaily.config;

  const today = todayKey();
  const guestRecipes: Partial<Record<string, GuestRecipeExtension[] | null>> = {};
  // T-0240: target-count daily removed. The daily today has no discovery
  // target; the manifest (T-0241+) will drive the win condition. For now
  // `dailyTarget` is always null so the engine's daily-win branch gated
  // on `state.target != null` never fires — the run only ends when the
  // board clogs. Kept as a prop until T-0241 removes `state.target`.
  const dailyTarget: number | null = null;
  let dailyPayloadSeed: number | null = null;
  const todaysPayload = await getDailyPayload(dailyHostTheme, today);
  if (todaysPayload) {
    dailyPayloadSeed = todaysPayload.seed;
    // todaysPayload.manifest is threaded into the client in T-0244.
  }
  if (activeDaily && todaysPayload && todaysPayload.guestOutputIds.length > 0) {
    const fullThemeBundle = buildThemeBundle(
      live.snapshot,
      activeDaily.themeCode,
      prev[activeDaily.themeCode] ?? 0,
    );
    const cappedThemeBundle = buildThemeBundle(
      live.snapshot,
      activeDaily.themeCode,
      prev[activeDaily.themeCode] ?? 0,
      "daily",
      activeDaily.config,
    );
    const { extensions } = resolveGuestRecipes(
      fullThemeBundle,
      cappedThemeBundle,
      todaysPayload.guestOutputIds,
    );
    guestRecipes[activeDaily.themeCode] = extensions;
  }
  const dailyBundles = buildAllDailyBundles(
    live.snapshot,
    prev,
    dailyConfigs,
    guestRecipes,
    themesToBuild,
  );

  // Serialise only the bundles we need. CombineBoard looks up by theme
  // code at runtime — shipping a single theme is fine while CombineBoard
  // runs under one theme at a time. Mode/theme switching reloads the page.
  const serialised: Record<string, ReturnType<typeof serialiseBundle>> = {};
  const fastSerialised: Record<string, ReturnType<typeof serialiseBundle>> = {};
  const dailySerialised: Record<string, ReturnType<typeof serialiseBundle>> = {};
  for (const code of themesToBuild) {
    if (bundles[code]) serialised[code] = serialiseBundle(bundles[code]);
    if (fastBundles[code]) fastSerialised[code] = serialiseBundle(fastBundles[code]);
    if (dailyBundles[code]) dailySerialised[code] = serialiseBundle(dailyBundles[code]);
  }

  const admin = await isAdmin();
  const session = await getSession();
  const signedIn = !!session?.user?.id;
  const dailyEnabled = dailyFlagOn() || admin;

  // T-0228: cheap server-side hint — do we have a saved run to restore?
  // When `true`, CombineBoard shows a shimmer skeleton on mount instead of
  // flashing the deterministic empty board. When `false` (signed-in user
  // with no saves), CombineBoard boots straight into the fresh starter
  // state with no shimmer. `null` means "unknown" (guest) → CombineBoard
  // assumes maybe and shows shimmer briefly.
  let hasActiveRunHint: boolean | null = null;
  if (signedIn && session?.user?.id) {
    const runs = await listActiveRuns({ kind: "user", id: session.user.id });
    hasActiveRunHint = runs.length > 0;
  }

  // Read the user's tutorial-seen flag so CombineBoard can hide the
  // "try the tutorial" nudge on repeat visits. Anon players fall back to
  // a localStorage check in-component.
  let userHasSeenTutorial = false;
  let currentUserHandle: string | null = null;
  if (signedIn && session?.user?.id) {
    const [row] = await db
      .select({
        seen: schema.authUser.hasSeenCombineTutorial,
        handle: schema.authUser.handle,
      })
      .from(schema.authUser)
      .where(eq(schema.authUser.id, session.user.id))
      .limit(1);
    userHasSeenTutorial = row?.seen === true;
    currentUserHandle = row?.handle ?? null;
  }

  const initialMode =
    modeParam === "fast"
      ? "fast"
      : modeParam === "tutorial"
        ? "tutorial"
        : undefined;

  return (
    <main className="wrap wrap-combine">
      <CombineBoard
        bundles={serialised}
        fastBundles={fastSerialised}
        dailyBundles={dailySerialised}
        dailyTarget={dailyEnabled ? dailyTarget : null}
        dailyPayloadSeed={dailyEnabled ? dailyPayloadSeed : null}
        dailyEnabled={dailyEnabled}
        admin={admin}
        signedIn={signedIn}
        activeTheme={activeTheme}
        initialMode={initialMode}
        themeFromUrl={themeFromUrl}
        dailyHostTheme={dailyHostTheme}
        publishedThemes={publishedThemes}
        userHasSeenTutorial={userHasSeenTutorial}
        currentUserHandle={currentUserHandle}
        hasActiveRunHint={hasActiveRunHint}
      />
      <Footer compactOnMobile />
    </main>
  );
}
