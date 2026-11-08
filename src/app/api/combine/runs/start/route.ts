import { NextResponse } from "next/server";
import { getRunOwner, serverRunsEnabled } from "@/lib/anon-session";
import { isAdmin } from "@/lib/session";
import {
  bundleForRun,
  dailyManifestForRun,
  mintSeed,
  newServerGame,
  type ServerMode,
} from "@/combine/server-engine";
import { createRun, getActiveRun, endRun } from "@/combine/run-store";
import { todayKey } from "@/combine/rng";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Start (or resume) a server-authoritative Combine run. The client
 * calls this when the player picks a mode/theme or opens the page
 * cold. The response carries the run id, seed, and initial state —
 * all authoritative — so the client can hydrate its local reducer.
 *
 * Body: { mode: 'endless'|'fast'|'daily', theme, dailyKey?, restart? }
 *   `restart=true` ends any existing active run for the slot and
 *   mints a fresh one. Default behaviour returns the existing run
 *   when present, so a refresh doesn't erase in-flight play.
 *
 * Returns 404 if feature-flag off (`COMBINE_SERVER_RUNS` unset).
 * Returns 400 on bad body; 500 on bundle-build errors.
 */
export async function POST(req: Request) {
  if (!serverRunsEnabled()) {
    return NextResponse.json({ error: "feature off" }, { status: 404 });
  }
  const owner = await getRunOwner();
  if (!owner) {
    return NextResponse.json({ error: "no identity" }, { status: 500 });
  }

  let body: {
    mode?: unknown;
    theme?: unknown;
    dailyKey?: unknown;
    restart?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const mode = parseMode(body.mode);
  if (!mode) return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  const theme = typeof body.theme === "string" ? body.theme : null;
  if (!theme) return NextResponse.json({ error: "invalid theme" }, { status: 400 });
  // Daily key is required for daily mode and coerced to today for stale clients
  // that forget to send it; endless/fast must omit it.
  const rawDaily = typeof body.dailyKey === "string" ? body.dailyKey : null;
  const dailyKey =
    mode === "daily"
      ? rawDaily && /^\d{4}-\d{2}-\d{2}$/.test(rawDaily)
        ? rawDaily
        : todayKey()
      : null;
  const restart = body.restart === true;

  // Resume path: an active run already exists for this slot.
  const existing = await getActiveRun(owner, mode, dailyKey);
  if (existing && !restart) {
    return NextResponse.json({
      runId: existing.id,
      seed: existing.seed,
      state: existing.stateJson,
      eventCount: existing.eventCount,
      epoch: existing.epoch,
      resumed: true,
    });
  }
  if (existing && restart) {
    await endRun(existing.id);
  }

  // Mint + build a fresh run.
  let bundle;
  try {
    bundle = await bundleForRun(mode, theme, dailyKey);
  } catch (err) {
    console.error("[runs/start] bundle build failed:", err);
    return NextResponse.json({ error: "bundle unavailable" }, { status: 500 });
  }
  const seed = mintSeed(mode, dailyKey);
  // T-0240: target-count dailies removed; manifest is the daily win
  // condition. The engine field itself (`state.manifest`) lands in
  // T-0241 — this step only plumbs the payload through so T-0241 has
  // something to receive.
  const manifest = await dailyManifestForRun(theme, dailyKey);
  const state = newServerGame({
    mode,
    theme,
    dailyKey,
    seed,
    bundle,
    manifest,
  });

  // Admin flag shadows onto the row via the state field; non-admin
  // clients can't flip it mid-run because checkpoint replay rejects
  // debug actions unless the request itself is from an admin.
  const admin = await isAdmin();
  if (admin) state.debug = false; // start clean; admin toggles in-session

  const row = await createRun({
    owner,
    mode,
    theme,
    dailyKey,
    seed,
    state,
  });

  return NextResponse.json({
    runId: row.id,
    seed: row.seed,
    state: row.stateJson,
    eventCount: row.eventCount,
    epoch: row.epoch,
    resumed: false,
  });
}

function parseMode(v: unknown): ServerMode | null {
  if (v === "endless" || v === "fast" || v === "daily") return v;
  return null;
}
