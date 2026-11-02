import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { Breadcrumb } from "./Breadcrumb";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const db = getDb();
  const [[allItems], [draftItems], [reviewItems], [canaryLinks]] = await Promise.all([
    db.select({ n: count() }).from(schema.items),
    db.select({ n: count() }).from(schema.items).where(eq(schema.items.status, "draft")),
    db.select({ n: count() }).from(schema.items).where(eq(schema.items.status, "review")),
    db.select({ n: count() }).from(schema.links).where(eq(schema.links.isCanary, true)),
  ]);

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin" }]} />
        <h2>Knowledge base</h2>
        <p>Edit items, links and evidence. Changes land as drafts; publish to make them live.</p>
      </section>

      <section className="feat">
        <h3 style={{ marginTop: 0 }}>Overview</h3>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: 0 }}>
          <dt style={{ color: "var(--muted)" }}>Items</dt>
          <dd style={{ margin: 0 }}>{allItems.n}</dd>
          <dt style={{ color: "var(--muted)" }}>Drafts</dt>
          <dd style={{ margin: 0 }}>{draftItems.n}</dd>
          <dt style={{ color: "var(--muted)" }}>In review</dt>
          <dd style={{ margin: 0 }}>{reviewItems.n}</dd>
          <dt style={{ color: "var(--muted)" }}>Canary links</dt>
          <dd style={{ margin: 0 }}>{canaryLinks.n}</dd>
        </dl>
      </section>

      <section className="feat">
        <h3 style={{ marginTop: 0 }}>Actions</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Link href="/admin/items" className="btn">Browse items</Link>
          <Link href="/admin/graph" className="btn">Graph view</Link>
          <Link href="/admin/pictograms" className="btn">Pictogram audit</Link>
          <Link href="/admin/import" className="btn">Import JSON</Link>
          <a href="/api/admin/export" className="btn" download>Download export</a>
        </div>
      </section>
      <Footer />
    </main>
  );
}
