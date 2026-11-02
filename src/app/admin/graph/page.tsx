import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { Breadcrumb } from "../Breadcrumb";
import { TreeList, type TreeData } from "./TreeList";

export const dynamic = "force-dynamic";

export default async function AdminGraphPage() {
  const db = getDb();
  const [items, allLinks, recipes] = await Promise.all([
    db
      .select({
        id: schema.items.id,
        name: schema.items.name,
        tier: schema.items.tier,
        kind: schema.items.kind,
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
  ]);

  const data: TreeData = {
    items,
    recipes,
    links: allLinks.map((l) => ({
      linkId: l.id,
      recipeId: l.recipeId,
      itemId: l.itemId,
      targetItemId: l.targetItemId,
      type: l.type,
      confidence: l.confidence,
    })),
  };

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Graph" }]} />
        <h2>Knowledge tree</h2>
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
