import Link from "next/link";
import { asc } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import type { ItemKind, Tier } from "@/db/schema";
import { Breadcrumb } from "../Breadcrumb";
import { PictogramAuditClient, type AuditItem, type AuditKind } from "./PictogramAuditClient";

export const dynamic = "force-dynamic";

export default async function PictogramAuditPage() {
  const db = getDb();
  const [items, kinds] = await Promise.all([
    db
      .select({
        id: schema.items.id,
        name: schema.items.name,
        tier: schema.items.tier,
        kind: schema.items.kind,
        symbol: schema.items.symbol,
        pictogram: schema.items.pictogram,
      })
      .from(schema.items)
      .orderBy(asc(schema.items.name)),
    db
      .select({
        code: schema.kinds.code,
        label: schema.kinds.label,
        position: schema.kinds.position,
        pictogram: schema.kinds.pictogram,
      })
      .from(schema.kinds)
      .orderBy(asc(schema.kinds.position), asc(schema.kinds.code)),
  ]);

  const itemsByKind: Record<string, AuditItem[]> = {};
  for (const it of items) {
    (itemsByKind[it.kind] ??= []).push({
      id: it.id,
      name: it.name,
      tier: it.tier as Tier,
      kind: it.kind as ItemKind,
      symbol: it.symbol,
      pictogram: it.pictogram,
    });
  }

  const kindRows: AuditKind[] = kinds.map((k) => ({
    code: k.code,
    label: k.label,
    pictogram: k.pictogram,
  }));

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Pictograms" }]} />
        <h2>Pictogram audit</h2>
        <p>
          Every item, grouped by kind. Items marked{" "}
          <strong>fallback</strong> use their kind&apos;s default pictogram.
          Click any tile to edit it; click <em>Edit fallback</em> next to a
          kind header to edit that kind&apos;s default.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <Link href="/admin/pictograms/upload" className="btn">
            Bulk upload pictograms
          </Link>
        </div>
      </section>

      <PictogramAuditClient itemsByKind={itemsByKind} kinds={kindRows} />

      <Footer />
    </main>
  );
}
