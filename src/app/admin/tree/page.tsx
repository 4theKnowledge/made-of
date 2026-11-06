import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { Breadcrumb } from "../Breadcrumb";
import { TreeList, type TreeData } from "./TreeList";

export const dynamic = "force-dynamic";

export default async function AdminGraphPage() {
  const db = getDb();
  const [items, allLinks, recipes, kinds, combineThemes, itemThemes] = await Promise.all([
    db
      .select({
        id: schema.items.id,
        name: schema.items.name,
        tier: schema.items.tier,
        kind: schema.items.kind,
        status: schema.items.status,
        firstAppeared: schema.items.firstAppeared,
        symbol: schema.items.symbol,
        fact: schema.items.fact,
        tags: schema.items.tags,
        isCanary: schema.items.isCanary,
        isCombineExcluded: schema.items.isCombineExcluded,
        updatedAt: schema.items.updatedAt,
      })
      .from(schema.items),
    db
      .select({
        id: schema.links.id,
        type: schema.links.type,
        confidence: schema.links.confidence,
        recipeId: schema.links.recipeId,
        itemId: schema.links.itemId,
        targetItemId: schema.links.targetItemId,
      })
      .from(schema.links),
    db
      .select({
        id: schema.recipes.id,
        itemId: schema.recipes.itemId,
        label: schema.recipes.label,
        position: schema.recipes.position,
      })
      .from(schema.recipes),
    db
      .select({ code: schema.kinds.code, label: schema.kinds.label, position: schema.kinds.position })
      .from(schema.kinds),
    db
      .select({
        code: schema.combineThemes.code,
        label: schema.combineThemes.label,
        position: schema.combineThemes.position,
      })
      .from(schema.combineThemes),
    db
      .select({
        itemId: schema.itemCombineThemes.itemId,
        themeCode: schema.itemCombineThemes.themeCode,
      })
      .from(schema.itemCombineThemes),
  ]);

  const data: TreeData = {
    items: items.map((it) => ({ ...it, updatedAt: it.updatedAt.toISOString() })),
    recipes,
    links: allLinks.map((l) => ({
      linkId: l.id,
      recipeId: l.recipeId,
      itemId: l.itemId,
      targetItemId: l.targetItemId,
      type: l.type,
      confidence: l.confidence,
    })),
    kinds: kinds
      .slice()
      .sort((a, b) => a.position - b.position || a.code.localeCompare(b.code))
      .map((k) => ({ code: k.code, label: k.label })),
    combineThemes: combineThemes
      .slice()
      .sort((a, b) => a.position - b.position || a.code.localeCompare(b.code))
      .map((t) => ({ code: t.code, label: t.label })),
    itemThemes: itemThemes.map((r) => ({ itemId: r.itemId, themeCode: r.themeCode })),
  };

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Knowledge base" }]} />
        <h2>Knowledge base</h2>
        <p>
          {items.length} items, {allLinks.length} links. Click a row to expand. Items with multiple parents appear in each lineage.
        </p>
      </section>

      <section className="feat" style={{ padding: 0 }}>
        <TreeList initialData={data} />
      </section>

      <Footer />
    </main>
  );
}
