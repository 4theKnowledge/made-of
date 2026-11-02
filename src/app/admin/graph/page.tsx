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
      .select({ id: schema.recipes.id, itemId: schema.recipes.itemId })
      .from(schema.recipes),
  ]);

  const recipeOwner = new Map(recipes.map((r) => [r.id, r.itemId]));

  // Normalise: every link has a resolved sourceId (the owning item) and a
  // targetId. Children map is sourceId -> list of (link + target).
  const childrenByParent = new Map<
    string,
    { linkId: string; targetId: string; type: typeof allLinks[number]["type"]; confidence: typeof allLinks[number]["confidence"] }[]
  >();
  const parentsByChild = new Map<
    string,
    { linkId: string; sourceId: string; type: typeof allLinks[number]["type"]; confidence: typeof allLinks[number]["confidence"] }[]
  >();

  for (const l of allLinks) {
    const sourceId = l.itemId ?? (l.recipeId ? recipeOwner.get(l.recipeId) ?? null : null);
    if (!sourceId) continue;
    const kids = childrenByParent.get(sourceId) ?? [];
    kids.push({ linkId: l.id, targetId: l.targetItemId, type: l.type, confidence: l.confidence });
    childrenByParent.set(sourceId, kids);
    const parents = parentsByChild.get(l.targetItemId) ?? [];
    parents.push({ linkId: l.id, sourceId, type: l.type, confidence: l.confidence });
    parentsByChild.set(l.targetItemId, parents);
  }

  // Roots = items with zero incoming links (big bang, etc.).
  const roots = items.filter((it) => !parentsByChild.has(it.id));

  const data: TreeData = {
    items,
    roots: roots.map((r) => r.id),
    childrenByParent: Object.fromEntries(childrenByParent),
    parentCountByItem: Object.fromEntries(
      Array.from(parentsByChild.entries()).map(([k, v]) => [k, v.length]),
    ),
  };

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Graph" }]} />
        <h2>Knowledge tree</h2>
        <p>
          {items.length} items, {allLinks.length} links. {roots.length} root
          {roots.length === 1 ? "" : "s"}. Click a row to expand. Items with multiple parents appear in each lineage.
        </p>
      </section>

      <section className="feat" style={{ padding: 0 }}>
        <TreeList data={data} />
      </section>

      <Footer />
    </main>
  );
}
