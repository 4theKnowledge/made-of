import { asc, eq, sql } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { Breadcrumb } from "../Breadcrumb";
import { KindsAdmin, type KindRow } from "./KindsAdmin";

export const dynamic = "force-dynamic";

export default async function AdminKindsPage() {
  const db = getDb();

  // Fetch kinds and a usage count per code in one go.
  const rows = await db
    .select({
      code: schema.kinds.code,
      label: schema.kinds.label,
      description: schema.kinds.description,
      position: schema.kinds.position,
      createdAt: schema.kinds.createdAt,
      updatedAt: schema.kinds.updatedAt,
    })
    .from(schema.kinds)
    .orderBy(asc(schema.kinds.position), asc(schema.kinds.code));

  const usage = await db
    .select({
      kind: schema.items.kind,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.items)
    .groupBy(schema.items.kind);
  const usageByCode = new Map(usage.map((u) => [u.kind, u.n]));
  // eq imported but not used -- future-proofing for status-filtered counts.
  void eq;

  const initial: KindRow[] = rows.map((r) => ({
    code: r.code,
    label: r.label,
    description: r.description,
    position: r.position,
    usage: usageByCode.get(r.code) ?? 0,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Kinds" }]} />
        <h2>Kinds</h2>
        <p>
          The vocabulary of what an item <em>is</em> — cosmic, element, mineral, substance, and so on. Every item has
          exactly one kind. Codes are immutable; delete and recreate to change one (only possible when no items use it).
        </p>
      </section>

      <section className="feat" style={{ padding: 0 }}>
        <KindsAdmin initial={initial} />
      </section>

      <Footer />
    </main>
  );
}
