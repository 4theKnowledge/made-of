import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { ItemEditForm } from "../ItemEditForm";
import { LinkRow } from "../LinkRow";
import { REL } from "@/lib/rel";

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
  const allTargetIds = Array.from(
    new Set([...recipeLinks, ...outLinks, ...inLinks].flatMap((l) => [l.targetItemId, l.itemId].filter(Boolean) as string[])),
  );
  const names = allTargetIds.length
    ? await db.select({ id: schema.items.id, name: schema.items.name }).from(schema.items).where(inArray(schema.items.id, allTargetIds))
    : [];
  const nameById = Object.fromEntries(names.map((n) => [n.id, n.name]));

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <span className="eyebrow">Admin · Item</span>
        <h2>{item.name}</h2>
        <p style={{ fontFamily: "var(--mono, monospace)", color: "var(--muted)" }}>{item.id}</p>
      </section>

      <section className="feat">
        <h3 style={{ marginTop: 0 }}>Core fields</h3>
        <ItemEditForm item={item} />
      </section>

      <section className="feat">
        <h3 style={{ marginTop: 0 }}>Recipes & outgoing links</h3>
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
        {inLinks.length === 0 && <p style={{ color: "var(--muted)" }}>Nothing links to this item yet.</p>}
        {inLinks.map((l) => {
          const parentId = l.itemId ?? "";
          const parentName = nameById[parentId] ?? parentId;
          return (
            <div key={l.id} style={{ fontSize: 14, padding: "4px 0" }}>
              <Link href={parentId ? `/admin/items/${encodeURIComponent(parentId)}` : "#"}>{parentName || "(recipe)"}</Link>
              <span style={{ color: "var(--muted)" }}> {REL[l.type].up.toLowerCase()}</span>
              <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>
                {l.type} · {l.confidence}
              </span>
            </div>
          );
        })}
      </section>

      <section className="feat">
        <Link href="/admin/items" className="btn">← Back to items</Link>
      </section>
      <Footer />
    </main>
  );
}
