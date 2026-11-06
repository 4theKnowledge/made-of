import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ========================================================================
 * Enums.
 *
 * Taxonomy: tier is F/N/M/C/P/S; link type is f/w/n/s/e; confidence
 * ladder has four rungs with hypothesis at the bottom.
 * ====================================================================== */

export const tierEnum = pgEnum("tier", ["F", "N", "M", "C", "P", "S"]);

export const itemStatusEnum = pgEnum("item_status", ["draft", "review", "live"]);

export const linkTypeEnum = pgEnum("link_type", ["f", "w", "n", "s", "e"]);

export const confidenceEnum = pgEnum("confidence", [
  "established",
  "strong",
  "debated",
  "hypothesis",
]);

export const evidenceStanceEnum = pgEnum("evidence_stance", [
  "supports",
  "contradicts",
]);

export const sourceKindEnum = pgEnum("source_kind", [
  "paper",
  "book",
  "review",
  "news",
  "government",
  "university",
  "museum",
  "industry",
  "encyclopedia",
]);

// Access-control role on the user table. `admin` unlocks /admin and the
// matching API routes. Flipped manually in Postgres (there is no self-serve
// path), so we keep the set small on purpose.
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

export const combineScopeEnum = pgEnum("combine_scope", ["endless", "daily"]);

// Reaction target discriminator. Lets one `reactions` table serve both item
// and recipe thumbs without duplicating the row shape per target type. See
// `reactions` below for the trade-off (no FK to the target; cleanup is
// best-effort via triggers / periodic sweep).
export const reactionTargetEnum = pgEnum("reaction_target", ["recipe", "item"]);

export const changelogStatusEnum = pgEnum("changelog_status", ["draft", "live"]);
export const changelogTypeEnum = pgEnum("changelog_type", [
  "feature",
  "fix",
  "content",
  "note",
]);

// Site-wide banner taxonomy. Many banners can be authored; at most one is
// `live` at a time (enforced by a partial unique index on the table).
// `archived` holds spent banners so audit history survives after unpublish.
export const siteBannerStatusEnum = pgEnum("site_banner_status", [
  "draft",
  "live",
  "archived",
]);
export const siteBannerSeverityEnum = pgEnum("site_banner_severity", [
  "info",
  "warn",
  "critical",
]);
export const siteBannerAudienceEnum = pgEnum("site_banner_audience", [
  "everyone",
  "signed_in",
  "signed_out",
  "admins_only",
]);

// User-feedback taxonomy. `suggest_item` and `suggest_recipe` grow the KB;
// `report` is "something broken" (may carry a recipe id or item id in the
// payload); `other` is the catch-all. Statuses are a light workflow for the
// admin triage page, not a full state machine.
export const feedbackTypeEnum = pgEnum("feedback_type", [
  "suggest_item",
  "suggest_recipe",
  "report",
  "other",
]);
export const feedbackStatusEnum = pgEnum("feedback_status", [
  "open",
  "triaged",
  "dismissed",
  "resolved",
]);

// Access codes. `invite` gates sign-up during soft-launch; `promo` is left
// open for future use (e.g. upgrade coupons, event drops). Both share the
// same table so admin tooling and redemption bookkeeping stay in one place.
export const codeKindEnum = pgEnum("code_kind", ["invite", "promo"]);

/* ========================================================================
 * Kinds.
 *
 * Was a Postgres enum; now a table so admins can add/rename kinds without
 * a migration. `code` is the stable identifier (lowercase, hyphen-safe) and
 * acts as the FK target on items.kind. `label` is the display string.
 * ====================================================================== */

export const kinds = pgTable(
  "kinds",
  {
    code: text("code").primaryKey(),
    label: text("label").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    // Fallback SVG inner-markup for this kind, used by items that don't have
    // their own `pictogram`. 32×32 viewBox, admin-authored. Nullable so a
    // newly-added kind can render with the generic frame until an admin
    // supplies one. See src/pictograms/data.ts for the original set and
    // docs/PICTOGRAM-STYLE.md for the authoring rules.
    pictogram: text("pictogram"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("kinds_position_idx").on(t.position)],
);

/* ========================================================================
 * Items.
 *
 * id is a uuid so renames don't break foreign keys. `slug` (lowercase,
 * hyphenated) and `name` (original casing, may contain spaces, e.g. "big
 * bang") stay as unique columns so URL routing, seed parity and recipe
 * parsing still work against the prototype.
 * ====================================================================== */

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull().unique(),
    tier: tierEnum("tier").notNull(),
    // Previously a pgEnum "item_kind". Now a text FK to kinds.code so admins
    // can add/rename kinds without a migration. ON DELETE RESTRICT because
    // deleting a kind that's still in use is a destructive mistake we want
    // to catch at the API layer with a clear error.
    kind: text("kind")
      .notNull()
      .references(() => kinds.code, { onDelete: "restrict", onUpdate: "cascade" }),
    firstAppeared: text("first_appeared"),
    // Years before 2026. Big bang is ~13.8e9, which overflows int32.
    firstAppearedYa: bigint("first_appeared_ya", { mode: "number" }),
    symbol: text("symbol"),
    fact: text("fact").notNull().default(""),
    // Item-specific SVG inner-markup. When null, Pictogram.tsx falls back
    // to the kind's pictogram (and, for elements, the symbol tile). 32×32
    // viewBox, admin-authored. See docs/PICTOGRAM-STYLE.md.
    pictogram: text("pictogram"),
    status: itemStatusEnum("status").notNull().default("live"),
    isCanary: boolean("is_canary").notNull().default(false),
    // True to hide this item from every Combine theme regardless of membership.
    // Safety net for items that are in the graph but shouldn't appear on the
    // board (e.g., big bang, abstract placeholders). Was previously a
    // "combine-exclude" string in `tags`; promoted to a column so typos and
    // free-form drift can't silently disable it.
    isCombineExcluded: boolean("is_combine_excluded").notNull().default(false),
    // Membership markers (see src/data/types.ts Tag). Treated as a closed
    // set at the type level; stored as a plain text[] here so new tags can
    // land without a migration.
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("items_tier_idx").on(t.tier),
    index("items_status_idx").on(t.status),
  ],
);

/* ========================================================================
 * Recipes.
 *
 * An item can be made more than one way. A recipe with no label is the
 * default. `position` keeps the artifact's recipe order (which the UI uses
 * for the recipe switcher).
 * ====================================================================== */

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    label: text("label"),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("recipes_item_idx").on(t.itemId),
    uniqueIndex("recipes_item_position_idx").on(t.itemId, t.position),
  ],
);

/* ========================================================================
 * Links.
 *
 * A link always has `type`, `targetItemId` and either `recipeId` (recipe-level
 * links: f, w, n, e) or `itemId` (item-level links: n, s). Exactly one of
 * recipeId / itemId is set.
 *
 * `confidence` denormalises the evidence's confidence onto the link so the
 * graph snapshot can filter without a join. Links without an EVIDENCE entry
 * inherit `established` by default; the migration test asserts that 354 links
 * get an explicit confidence from EVIDENCE.
 * ====================================================================== */

export const links = pgTable(
  "links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id").references(() => recipes.id, {
      onDelete: "cascade",
    }),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
    type: linkTypeEnum("type").notNull(),
    targetItemId: uuid("target_item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    confidence: confidenceEnum("confidence").notNull().default("established"),
    note: text("note"),
    isCanary: boolean("is_canary").notNull().default(false),
  },
  (t) => [
    index("links_recipe_idx").on(t.recipeId),
    index("links_item_idx").on(t.itemId),
    index("links_target_idx").on(t.targetItemId),
    index("links_type_idx").on(t.type),
    // Exactly one of recipeId / itemId must be set.
    // A plain SQL check lives in the generated migration; Drizzle expresses it:
    // (This becomes a CHECK on migrate.)
  ],
);

/* ========================================================================
 * Link evidence and sources.
 * ====================================================================== */

export const linkEvidence = pgTable(
  "link_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    stance: evidenceStanceEnum("stance").notNull(),
    summary: text("summary").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("link_evidence_link_idx").on(t.linkId)],
);

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The author-year citation key used in the knowledge base, e.g.
  // "src:martin-2008". Stays unique so admin edits can rely on it, but is no
  // longer the primary key — foreign keys from evidence_sources reference the
  // uuid instead.
  code: text("code").notNull().unique(),
  kind: sourceKindEnum("kind").notNull(),
  title: text("title").notNull(),
  authors: text("authors"),
  year: integer("year"),
  published: text("published"),
  url: text("url"),
});

export const evidenceSources = pgTable(
  "evidence_sources",
  {
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => linkEvidence.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.evidenceId, t.sourceId] }),
    index("evidence_sources_source_idx").on(t.sourceId),
  ],
);

/* ========================================================================
 * Daily puzzles.
 *
 * The answer path never leaves the server (see CLAUDE.md hard rules), so no
 * answer column exists here. The server computes paths on demand from the
 * graph snapshot.
 * ====================================================================== */

export const dailyPuzzles = pgTable(
  "daily_puzzles",
  {
    date: text("date").primaryKey(), // yyyy-mm-dd in UTC
    startItemId: uuid("start_item_id")
      .notNull()
      .references(() => items.id),
    goalItemId: uuid("goal_item_id")
      .notNull()
      .references(() => items.id),
    par: integer("par").notNull(),
    difficulty: integer("difficulty").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("daily_puzzles_pair_idx").on(t.startItemId, t.goalItemId)],
);

/* ========================================================================
 * Better Auth tables.
 *
 * Column names match Better Auth's defaults so no custom field mapping is
 * needed. `tier` and `ageConfirmedAt` are Made Of additions: tier gates
 * paid routes (CLAUDE.md hard rule — entitlements on the server), and
 * ageConfirmedAt records the 13+ confirmation collected at sign-up.
 * ====================================================================== */

export const authUser = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name"),
    image: text("image"),
    tier: text("tier").notNull().default("free"),
    role: userRoleEnum("role").notNull().default("user"),
    ageConfirmedAt: timestamp("age_confirmed_at", { withTimezone: true }),
    // Public display name, e.g. "swift-quartz". Auto-assigned on sign-up and
    // immutable once the user locks it in with handleLockedAt. Nullable so a
    // transient blank window during the create hook isn't a hard failure.
    handle: text("handle"),
    handleLockedAt: timestamp("handle_locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("user_handle_lower_idx").on(sql`lower(${t.handle})`)],
);

export const authSession = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const authAccount = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const authVerification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* ========================================================================
 * Progress, reports, subscriptions.
 * ====================================================================== */

export const progress = pgTable(
  "progress",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    kind: text("kind").notNull(), // daily | scratch | goal
    ref: text("ref").notNull(),
    result: jsonb("result").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("progress_user_idx").on(t.userId),
    index("progress_kind_ref_idx").on(t.kind, t.ref),
  ],
);

/* ========================================================================
 * Combine themes.
 *
 * A theme is a curated subset of items that are playable together (e.g.
 * "everything", "everyday"). Admin-managed vocabulary with a reachability
 * validator so themes can't ship with items that have no buildable recipe.
 * `code` is the stable identifier used in game code; `label` is the display
 * string. Daily puzzle is a scope (combine_discoveries.scope), not a theme —
 * the daily draws from whichever theme the puzzle references.
 * ====================================================================== */

export const combineThemes = pgTable(
  "combine_themes",
  {
    code: text("code").primaryKey(),
    label: text("label").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("combine_themes_position_idx").on(t.position)],
);

/* ========================================================================
 * Combine daily config (singleton).
 *
 * The daily mode is a top-level gameplay concept: one theme is "the daily
 * theme" at a time, and that theme's daily carries the knobs (capped
 * ages, ageNeedScale, guest ingredient). Modelled as a singleton row so
 * there's always exactly one "active" config; swapping which theme hosts
 * the daily is a single UPDATE.
 *
 * Shape of `config`: { maxAges?, ageNeedScale?, guestIngredient? } — see
 * DailyConfig in src/combine/daily-config.ts.
 * ====================================================================== */

export const combineDailyConfig = pgTable("combine_daily_config", {
  // Fixed PK — there's only ever one row. Enforces singleton without a
  // partial-unique-index dance.
  id: text("id").primaryKey().default("current"),
  themeCode: text("theme_code")
    .notNull()
    .references(() => combineThemes.code, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* Many-to-many membership: an item can belong to several themes. */
export const itemCombineThemes = pgTable(
  "item_combine_themes",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    themeCode: text("theme_code")
      .notNull()
      .references(() => combineThemes.code, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.themeCode] }),
    index("item_combine_themes_theme_idx").on(t.themeCode),
  ],
);

/* ========================================================================
 * Combine dailies (precomputed per-day payload per theme).
 *
 * One row per (themeCode, day). `payload` freezes everything the game and
 * admin need to render that day's daily — the dailyConfig as it was at
 * generation time, the resolved guest output ids, and the RNG seed. A
 * Railway cron (POST /api/internal/combine-dailies/extend) keeps ~30 days
 * ahead; the per-theme admin page exposes a manual regenerate for days ≥
 * today. Past rows are immutable (historical record of what was served).
 *
 * Payload shape (v1): see `DailyPayload` in src/combine/daily-schedule.ts.
 * ====================================================================== */

export const combineDailies = pgTable(
  "combine_dailies",
  {
    themeCode: text("theme_code")
      .notNull()
      .references(() => combineThemes.code, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    // yyyy-mm-dd (same format `todayKey()` produces).
    day: text("day").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.themeCode, t.day] }),
    index("combine_dailies_day_idx").on(t.day),
  ],
);

/* ========================================================================
 * Combine season.
 *
 * One row per theme tracking the highest `numAges` value ever promoted. The
 * active bundle derives numAges from recipe count, but monotonicity is
 * enforced against this stored value so a KB edit can never retroactively
 * shrink the number of ages on a theme. Updated when a build sees a derived
 * value greater than the stored one. `promotedAt` records the last bump —
 * used to drive the "a new age has emerged" announcement.
 * ====================================================================== */

export const combineSeason = pgTable("combine_season", {
  theme: text("theme").primaryKey(),
  numAges: integer("num_ages").notNull().default(0),
  promotedAt: timestamp("promoted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CombineSeason = typeof combineSeason.$inferSelect;

/* ========================================================================
 * Combine discoveries.
 *
 * Signed-in users accumulate a lifetime collection of items first discovered
 * across Combine runs. Collections are partitioned by `scope` so the daily
 * puzzle has its own fair-start collection — endless grinding doesn't let a
 * player walk into a daily with items pre-unlocked. Keyed on
 * (userId, itemId, scope); `firstFoundAt` is set on first discovery per
 * scope and never changes.
 *
 * Signed-out users keep an in-memory collection for the current session only.
 * ====================================================================== */

export const combineDiscoveries = pgTable(
  "combine_discoveries",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    scope: combineScopeEnum("scope").notNull().default("endless"),
    firstFoundAt: timestamp("first_found_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Sorted-ingredient signatures (sort(recipe.all).join("+")) the player has
    // used to make this item under this scope. Empty = unlocked via a
    // base-ingredient leak (no make), or pre-mastery discovery. Mastery = this
    // set covers every variant whose ingredients are all known to the player.
    recipeSignatures: text("recipe_signatures")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.itemId, t.scope] }),
    index("combine_discoveries_user_idx").on(t.userId),
    index("combine_discoveries_user_scope_idx").on(t.userId, t.scope),
  ],
);

/* ========================================================================
 * Access codes.
 *
 * Soft-launch invite gate plus a header for future promo codes. `code` is
 * the primary key — admins mint the string and hand it out directly. For
 * invites, `maxUses` is usually 1 (single-use) but can be null for an
 * unlimited "team" code. Expired or spent codes are rejected server-side;
 * the UI never sees the full list.
 * ====================================================================== */

export const codes = pgTable(
  "codes",
  {
    code: text("code").primaryKey(),
    kind: codeKindEnum("kind").notNull().default("invite"),
    // null = unlimited uses. Enforced server-side against `uses`.
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("codes_kind_idx").on(t.kind)],
);

export const codeRedemptions = pgTable(
  "code_redemptions",
  {
    code: text("code")
      .notNull()
      .references(() => codes.code, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.code, t.userId] }),
    index("code_redemptions_user_idx").on(t.userId),
  ],
);

/* ========================================================================
 * Reactions.
 *
 * Polymorphic user feedback on items and recipes: 👍 / 👎 with an optional
 * `reason` text. One row per (user, target_kind, target_id); re-voting
 * flips the value via ON CONFLICT DO UPDATE and a 0-value POST deletes
 * the row (toggle-off).
 *
 * Why polymorphic rather than two tables: the UI primitive, hook, API
 * route, and admin triage are identical regardless of target kind.
 * Adding a third target (sources, kinds) later is just a new enum value.
 * The trade-off is no FK into items/recipes — Postgres can't FK
 * conditionally on an enum. Stale rows are harmless (a deleted
 * item/recipe can't have its reactions queried through the normal UI);
 * a periodic sweep or ON DELETE trigger can clean up when it matters.
 * ====================================================================== */

export const reactions = pgTable(
  "reactions",
  {
    targetKind: reactionTargetEnum("target_kind").notNull(),
    // Both items.id and recipes.id are UUIDs so a single column covers both.
    // No FK: see table-level comment.
    targetId: uuid("target_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    // Constrained to {-1, +1} by a CHECK constraint in the migration.
    // 0 is not stored (a 0-value POST deletes the row).
    value: smallint("value").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.targetKind, t.targetId, t.userId] }),
    index("reactions_target_idx").on(t.targetKind, t.targetId),
    index("reactions_user_idx").on(t.userId),
  ],
);

export type Reaction = typeof reactions.$inferSelect;

export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    itemId: uuid("item_id").references(() => items.id),
    linkId: uuid("link_id").references(() => links.id),
    reason: text("reason").notNull(),
    note: text("note"),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("reports_status_idx").on(t.status)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    userId: text("user_id").primaryKey(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    plan: text("plan").notNull(),
    status: text("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("subscriptions_customer_idx").on(t.stripeCustomerId)],
);

/* ========================================================================
 * Changelog.
 *
 * Admin-authored release notes rendered at /changelog. `slug` gives entries
 * stable anchor URLs. `body` is markdown. Only `status = 'live'` rows are
 * public — `publishedAt` is stamped when an entry flips draft→live and
 * drives the public ordering.
 * ====================================================================== */

export const changelogEntries = pgTable(
  "changelog_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    type: changelogTypeEnum("type").notNull().default("feature"),
    body: text("body").notNull().default(""),
    status: changelogStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("changelog_status_idx").on(t.status),
    index("changelog_published_idx").on(t.publishedAt),
  ],
);

/* ========================================================================
 * Site banners.
 *
 * Admin-authored app-wide notices rendered above the page chrome. Many can
 * be drafted; a partial unique index pins at most one to `status = 'live'`.
 * `startsAt`/`endsAt` are optional soft bounds checked at read time, so an
 * admin can schedule a live banner to show only during a window without
 * bouncing back to draft. `audience` controls visibility by auth state.
 * ====================================================================== */

export const siteBanners = pgTable(
  "site_banners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    body: text("body").notNull().default(""),
    severity: siteBannerSeverityEnum("severity").notNull().default("info"),
    status: siteBannerStatusEnum("status").notNull().default("draft"),
    audience: siteBannerAudienceEnum("audience").notNull().default("everyone"),
    dismissible: boolean("dismissible").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("site_banners_status_idx").on(t.status),
    uniqueIndex("site_banners_one_live_idx")
      .on(t.status)
      .where(sql`${t.status} = 'live'`),
  ],
);

/* ========================================================================
 * Feedback.
 *
 * User-submitted feedback routed to /admin/feedback for triage. One row per
 * submission; the shape of `payload` depends on `type`:
 *   - suggest_item:   { name, context? }
 *   - suggest_recipe: { output?: itemId | string, inputs: Array<itemId | string>, note? }
 *   - report:         { category?: string, note?: string, recipeId?, itemId?, recipeInputs?: string[] }
 *   - other:          { note }
 *
 * `url` captures the page the user was on when they hit submit. `userId` is
 * null for anonymous submissions (anon is rate-limited; recipe suggestions
 * require auth, enforced in the route handler). `status` drives the admin
 * triage column.
 * ====================================================================== */

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: feedbackTypeEnum("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    userId: text("user_id").references(() => authUser.id, {
      onDelete: "set null",
    }),
    url: text("url"),
    status: feedbackStatusEnum("status").notNull().default("open"),
    adminNote: text("admin_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("feedback_status_idx").on(t.status),
    index("feedback_type_idx").on(t.type),
    index("feedback_created_idx").on(t.createdAt),
  ],
);

/* ========================================================================
 * Relations.
 * ====================================================================== */

export const itemsRelations = relations(items, ({ many }) => ({
  recipes: many(recipes),
  itemLinks: many(links, { relationName: "item_links" }),
  incoming: many(links, { relationName: "incoming" }),
}));

export const recipesRelations = relations(recipes, ({ one, many }) => ({
  item: one(items, { fields: [recipes.itemId], references: [items.id] }),
  links: many(links),
}));

export const linksRelations = relations(links, ({ one, many }) => ({
  recipe: one(recipes, { fields: [links.recipeId], references: [recipes.id] }),
  item: one(items, {
    fields: [links.itemId],
    references: [items.id],
    relationName: "item_links",
  }),
  target: one(items, {
    fields: [links.targetItemId],
    references: [items.id],
    relationName: "incoming",
  }),
  evidence: many(linkEvidence),
}));

export const linkEvidenceRelations = relations(
  linkEvidence,
  ({ one, many }) => ({
    link: one(links, { fields: [linkEvidence.linkId], references: [links.id] }),
    sources: many(evidenceSources),
  }),
);

export const evidenceSourcesRelations = relations(
  evidenceSources,
  ({ one }) => ({
    evidence: one(linkEvidence, {
      fields: [evidenceSources.evidenceId],
      references: [linkEvidence.id],
    }),
    source: one(sources, {
      fields: [evidenceSources.sourceId],
      references: [sources.id],
    }),
  }),
);

/* ========================================================================
 * Type exports.
 * ====================================================================== */

export type Tier = (typeof tierEnum.enumValues)[number];
// Kind codes are user-managed now (see the `kinds` table), so the TS type
// is a plain string. API handlers validate against the live set of codes
// at write time.
export type ItemKind = string;
export type Kind = typeof kinds.$inferSelect;
export type NewKind = typeof kinds.$inferInsert;
export type CombineTheme = typeof combineThemes.$inferSelect;
export type NewCombineTheme = typeof combineThemes.$inferInsert;
export type ItemCombineTheme = typeof itemCombineThemes.$inferSelect;
export type ItemStatus = (typeof itemStatusEnum.enumValues)[number];
export type LinkType = (typeof linkTypeEnum.enumValues)[number];
export type Confidence = (typeof confidenceEnum.enumValues)[number];
export type EvidenceStance = (typeof evidenceStanceEnum.enumValues)[number];
export type SourceKind = (typeof sourceKindEnum.enumValues)[number];
export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type ChangelogStatus = (typeof changelogStatusEnum.enumValues)[number];
export type ChangelogType = (typeof changelogTypeEnum.enumValues)[number];
export type ChangelogEntry = typeof changelogEntries.$inferSelect;
export type NewChangelogEntry = typeof changelogEntries.$inferInsert;
export type SiteBannerStatus = (typeof siteBannerStatusEnum.enumValues)[number];
export type SiteBannerSeverity = (typeof siteBannerSeverityEnum.enumValues)[number];
export type SiteBannerAudience = (typeof siteBannerAudienceEnum.enumValues)[number];
export type SiteBanner = typeof siteBanners.$inferSelect;
export type NewSiteBanner = typeof siteBanners.$inferInsert;
export type FeedbackType = (typeof feedbackTypeEnum.enumValues)[number];
export type FeedbackStatus = (typeof feedbackStatusEnum.enumValues)[number];
export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
export type LinkEvidence = typeof linkEvidence.$inferSelect;
export type NewLinkEvidence = typeof linkEvidence.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
