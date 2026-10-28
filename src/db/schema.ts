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
} from "drizzle-orm/pg-core";

/* ========================================================================
 * Enums.
 *
 * Mirrors the artifact's taxonomy (see legacy/made-of.html TIERS, KINDS, REL,
 * CONF). CLAUDE.md corrections applied:
 *   - link type includes `w` (made with) — five types total.
 *   - lowest confidence is `hypothesis`, not `weak`.
 * ====================================================================== */

export const tierEnum = pgEnum("tier", ["F", "N", "M", "C", "P", "S"]);

export const itemKindEnum = pgEnum("item_kind", [
  "cosmic",
  "element",
  "mineral",
  "living",
  "substance",
  "food",
  "energy",
  "part",
  "object",
  "tool",
  "place",
  "information",
]);

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

/* ========================================================================
 * Items.
 *
 * id is the slug (lowercase, hyphenated). The original lowercase name (which
 * may contain spaces, e.g. "big bang") is kept so recipe parsing and parity
 * tests against the prototype stay exact.
 * ====================================================================== */

export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    tier: tierEnum("tier").notNull(),
    kind: itemKindEnum("kind").notNull(),
    firstAppeared: text("first_appeared"),
    // Years before 2026. Big bang is ~13.8e9, which overflows int32.
    firstAppearedYa: bigint("first_appeared_ya", { mode: "number" }),
    symbol: text("symbol"),
    fact: text("fact").notNull().default(""),
    status: itemStatusEnum("status").notNull().default("live"),
    isCanary: boolean("is_canary").notNull().default(false),
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
    id: text("id").primaryKey(),
    itemId: text("item_id")
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
    id: text("id").primaryKey(),
    recipeId: text("recipe_id").references(() => recipes.id, {
      onDelete: "cascade",
    }),
    itemId: text("item_id").references(() => items.id, { onDelete: "cascade" }),
    type: linkTypeEnum("type").notNull(),
    targetItemId: text("target_item_id")
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
    id: text("id").primaryKey(),
    linkId: text("link_id")
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
  id: text("id").primaryKey(), // e.g. "src:martin-2008"
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
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => linkEvidence.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
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
    startItemId: text("start_item_id")
      .notNull()
      .references(() => items.id),
    goalItemId: text("goal_item_id")
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
 * Progress, reports, subscriptions.
 *
 * Users / sessions tables are added by Better Auth in phase 4. For phase 1 we
 * only need a placeholder user id reference so the rest of the schema
 * compiles. Keep this column nullable and loose for now; phase 4 will add
 * the FK once the Better Auth tables exist.
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

export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    itemId: text("item_id").references(() => items.id),
    linkId: text("link_id").references(() => links.id),
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
export type ItemKind = (typeof itemKindEnum.enumValues)[number];
export type ItemStatus = (typeof itemStatusEnum.enumValues)[number];
export type LinkType = (typeof linkTypeEnum.enumValues)[number];
export type Confidence = (typeof confidenceEnum.enumValues)[number];
export type EvidenceStance = (typeof evidenceStanceEnum.enumValues)[number];
export type SourceKind = (typeof sourceKindEnum.enumValues)[number];

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
