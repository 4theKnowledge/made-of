import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { Breadcrumb } from "../../../Breadcrumb";
import { collectRecipeParts, isPlayableRecipe, type RecipePartType } from "@/combine/parts";
import type { Tier, ItemKind } from "@/db/schema";
import type { ClosureConfig } from "@/combine/closure";
import { ThemeBuilder, type BuilderItem } from "./ThemeBuilder";
import { ThemeSettings } from "./ThemeSettings";

export const dynamic = "force-dynamic";

export default async function AdminCombineThemeDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const themeCode = decodeURIComponent(code);
  const db = getDb();

  const [theme] = await db
    .select()
    .from(schema.combineThemes)
    .where(eq(schema.combineThemes.code, themeCode))
    .limit(1);
  if (!theme) return notFound();

  const memberRows = await db
    .select({ itemId: schema.itemCombineThemes.itemId, source: schema.itemCombineThemes.source })
    .from(schema.itemCombineThemes)
    .where(eq(schema.itemCombineThemes.themeCode, themeCode));
  const memberIds = memberRows.map((r) => r.itemId);
  const initialMemberSources: Record<string, string> = Object.fromEntries(
    memberRows.map((r) => [r.itemId, r.source]),
  );

  // Pull everything the builder needs. ~350 items × ~8 fields is well under
  // 100 KB on the wire — ship it all so the client can filter without
  // round-trips.
  const items = await db
    .select({
      id: schema.items.id,
      name: schema.items.name,
      slug: schema.items.slug,
      tier: schema.items.tier,
      kind: schema.items.kind,
      status: schema.items.status,
      tags: schema.items.tags,
      isCombineExcluded: schema.items.isCombineExcluded,
    })
    .from(schema.items)
    .orderBy(asc(schema.items.name));

  const recipes = await db
    .select({ id: schema.recipes.id, itemId: schema.recipes.itemId })
    .from(schema.recipes);

  const recipeIds = recipes.map((r) => r.id);
  const recipeLinks = recipeIds.length
    ? await db
        .select({
          recipeId: schema.links.recipeId,
          targetItemId: schema.links.targetItemId,
          type: schema.links.type,
        })
        .from(schema.links)
        .where(inArray(schema.links.recipeId, recipeIds))
    : [];

  const edgesByRecipe = new Map<string, { type: string; targetId: string }[]>();
  for (const l of recipeLinks) {
    if (!l.recipeId) continue;
    const list = edgesByRecipe.get(l.recipeId) ?? [];
    list.push({ type: l.type, targetId: l.targetItemId });
    edgesByRecipe.set(l.recipeId, list);
  }

  // Only ship playable recipes — the ones Combine's runtime would surface.
  // Validator and closure both rely on parity; see src/combine/parts.ts.
  // Also ship partTypes aligned with parts so the client-side closure
  // preview can honour `followLinkTypes`.
  const playableRecipes = recipes
    .map((r) => {
      const edges = edgesByRecipe.get(r.id) ?? [];
      const { all, hadSelfRef } = collectRecipeParts(edges, r.itemId);
      return { id: r.id, itemId: r.itemId, parts: all, hadSelfRef, edges };
    })
    .filter((r) => isPlayableRecipe({ all: r.parts, hadSelfRef: r.hadSelfRef }))
    .map((r) => {
      const typeByPart = new Map<string, RecipePartType>();
      for (const e of r.edges) {
        if (e.targetId === r.itemId) continue;
        if (e.type !== "f" && e.type !== "w" && e.type !== "n" && e.type !== "e") continue;
        if (!typeByPart.has(e.targetId)) typeByPart.set(e.targetId, e.type as RecipePartType);
      }
      return {
        id: r.id,
        itemId: r.itemId,
        parts: r.parts,
        partTypes: r.parts.map((id) => typeByPart.get(id) ?? "f"),
      };
    });

  // Facet lists.
  const tiers: Tier[] = ["F", "N", "M", "C", "P", "S"];
  const kinds = Array.from(new Set(items.map((i) => i.kind))).sort() as ItemKind[];
  const tags = Array.from(new Set(items.flatMap((i) => i.tags ?? []))).sort();

  const builderItems: BuilderItem[] = items.map((i) => ({
    id: i.id,
    name: i.name,
    slug: i.slug,
    tier: i.tier,
    kind: i.kind,
    status: i.status,
    tags: i.tags ?? [],
    isCombineExcluded: i.isCombineExcluded,
  }));

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb
          trail={[
            { label: "Admin", href: "/admin" },
            { label: "Combine themes", href: "/admin/combine/themes" },
            { label: theme.label },
          ]}
        />
        <h2>
          {theme.label}
          {theme.isPublished ? (
            <span
              style={{
                marginLeft: 10,
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 10,
                background: "var(--good)",
                color: "var(--bg)",
                verticalAlign: "middle",
              }}
            >
              Published
            </span>
          ) : (
            <span
              style={{
                marginLeft: 10,
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 10,
                border: "1px solid var(--line)",
                color: "var(--muted)",
                verticalAlign: "middle",
              }}
            >
              Draft
            </span>
          )}
        </h2>
        <p style={{ fontFamily: "var(--mono, monospace)", color: "var(--muted)" }}>{theme.code}</p>
        {theme.description && <p>{theme.description}</p>}
      </section>

      <ThemeSettings
        themeCode={theme.code}
        initialIsPublished={theme.isPublished}
        initialPictogram={theme.pictogram ?? null}
        memberCount={memberIds.length}
      />

      <ThemeBuilder
        themeCode={theme.code}
        themeLabel={theme.label}
        initialMemberIds={memberIds}
        initialMemberSources={initialMemberSources}
        initialClosureConfig={(theme.closureConfig ?? null) as ClosureConfig | null}
        items={builderItems}
        recipes={playableRecipes}
        availableTiers={tiers}
        availableKinds={kinds}
        availableTags={tags}
      />

      <section className="feat">
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
          Bulk edits across many items at once still live in the{" "}
          <Link href="/admin/tree">knowledge base</Link> — select items, use the bar&rsquo;s &ldquo;Edit themes&rdquo; action.
        </p>
      </section>

      <Footer />
    </main>
  );
}
