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
    status: itemStatusEnum("status").notNull().default("live"),
    isCanary: boolean("is_canary").notNull().default(false),
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
