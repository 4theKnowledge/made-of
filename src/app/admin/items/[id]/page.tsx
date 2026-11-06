import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { ItemEditForm } from "../ItemEditForm";
import { LinkRow } from "../LinkRow";
import { REL } from "@/lib/rel";
import { Breadcrumb } from "../../Breadcrumb";

export const dynamic = "force-dynamic";

export default async function AdminItemEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const [item] = await db.select().from(schema.items).where(eq(schema.items.id, id)).limit(1);
  if (!item) return notFound();

  const [recipes, outLinks, inLinks] = await Promise.all([
    db.select().from(schema.recipes).where(eq(schema.recipes.itemId, id)),
    db.select().from(schema.links).where(eq(schema.links.itemId, id)),
    db.select().from(schema.links).where(eq(schema.links.targetItemId, id)),
  ]);
  const recipeIds = recipes.map((r) => r.id);
  const recipeLinks = recipeIds.length
    ? await db.select().from(schema.links).where(inArray(schema.links.recipeId, recipeIds))
    : [];
  const inRecipeIds = Array.from(
    new Set(inLinks.map((l) => l.recipeId).filter(Boolean) as string[]),
  );
  const inRecipes = inRecipeIds.length
    ? await db.select().from(schema.recipes).where(inArray(schema.recipes.id, inRecipeIds))
    : [];
  const recipeOwnerById = Object.fromEntries(
    inRecipes.map((r) => [r.id, { itemId: r.itemId, position: r.position, label: r.label }]),
  );
  const allTargetIds = Array.from(
    new Set(
      [...recipeLinks, ...outLinks, ...inLinks]
        .flatMap((l) => [l.targetItemId, l.itemId].filter(Boolean) as string[])
        .concat(inRecipes.map((r) => r.itemId)),
    ),
  );
  const names = allTargetIds.length
    ? await db.select({ id: schema.items.id, name: schema.items.name }).from(schema.items).where(inArray(schema.items.id, allTargetIds))
    : [];
  const nameById = Object.fromEntries(names.map((n) => [n.id, n.name]));

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb
          trail={[
            { label: "Admin", href: "/admin" },
            { label: "Items", href: "/admin/items" },
            { label: item.name },
          ]}
        />
        <h2>{item.name}</h2>
        <p style={{ fontFamily: "var(--mono, monospace)", color: "var(--muted)" }}>{item.id}</p>
      </section>

      <section className="feat">
        <h3 style={{ marginTop: 0 }}>Core fields</h3>
        <ItemEditForm item={item} />
      </section>

      <section className="feat">
        <h3 style={{ marginTop: 0 }}>Recipes & outgoing links</h3>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 13 }}>
          Ways this item is made. Each recipe groups the links (made from, made with, evolved from) that produce it. Item-level links (needs, comes from) sit outside recipes.
        </p>
        {recipes.length === 0 && <p style={{ color: "var(--muted)" }}>No recipes.</p>}
        {recipes
          .sort((a, b) => a.position - b.position)
          .map((r) => {
            const rl = recipeLinks.filter((l) => l.recipeId === r.id);
            return (
              <div key={r.id} style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  Recipe {r.position}
                  {r.label ? ` · ${r.label}` : ""}
                </div>
                {rl.length === 0 ? (
                  <p style={{ color: "var(--muted)", margin: 0 }}>No links in this recipe.</p>
                ) : (
                  rl.map((l) => (
                    <LinkRow
                      key={l.id}
                      link={l}
                      targetName={nameById[l.targetItemId] ?? l.targetItemId}
                      verb={REL[l.type].up}
                    />
                  ))
                )}
              </div>
            );
          })}
        {outLinks.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              Item-level links
            </div>
            {outLinks.map((l) => (
              <LinkRow key={l.id} link={l} targetName={nameById[l.targetItemId] ?? l.targetItemId} verb={REL[l.type].up} />
            ))}
          </div>
        )}
      </section>

      <section className="feat">
        <h3 style={{ marginTop: 0 }}>Incoming ({inLinks.length})</h3>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 13 }}>
          Other items that reference this one — either in their recipes or via item-level links. Follow any row to edit the parent.
        </p>
        {inLinks.length === 0 && <p style={{ color: "var(--muted)" }}>Nothing links to this item yet.</p>}
        {inLinks.map((l) => {
          const recipe = l.recipeId ? recipeOwnerById[l.recipeId] : null;
          const parentId = l.itemId ?? recipe?.itemId ?? "";
          const parentName = nameById[parentId] ?? parentId;
          const viaRecipe = recipe
            ? ` (recipe ${recipe.position}${recipe.label ? ` · ${recipe.label}` : ""})`
            : "";
          return (
            <div key={l.id} style={{ fontSize: 14, padding: "4px 0" }}>
              <Link href={parentId ? `/admin/items/${encodeURIComponent(parentId)}` : "#"}>{parentName || "(unknown)"}</Link>
              {viaRecipe && (
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{viaRecipe}</span>
              )}
              <span style={{ color: "var(--muted)" }}> {REL[l.type].up.toLowerCase()}</span>
              <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>
                {l.type} · {l.confidence}
              </span>
            </div>
          );
        })}
      </section>

      <div style={{ marginTop: 16 }}>
        <Link href="/admin/items" className="btn">← Back to items</Link>
      </div>
      <Footer />
    </main>
  );
}
