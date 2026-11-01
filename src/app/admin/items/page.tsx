import Link from "next/link";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import type { ItemStatus, Tier } from "@/db/schema";
import { TIER } from "@/lib/taxonomy";
import { Breadcrumb } from "../Breadcrumb";

export const dynamic = "force-dynamic";

export default async function AdminItemsList({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; tier?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const status = (sp.status || "") as ItemStatus | "";
  const tier = (sp.tier || "") as Tier | "";

  const db = getDb();
  const conds = [];
  if (q)
    conds.push(
      or(
        ilike(schema.items.name, `%${q}%`),
        ilike(schema.items.slug, `%${q}%`),
      ),
    );
  if (status) conds.push(eq(schema.items.status, status));
  if (tier) conds.push(eq(schema.items.tier, tier));

  const rows = await db
    .select({
      id: schema.items.id,
      name: schema.items.name,
      tier: schema.items.tier,
      kind: schema.items.kind,
      status: schema.items.status,
      updatedAt: schema.items.updatedAt,
    })
    .from(schema.items)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.items.updatedAt), asc(schema.items.id))
    .limit(200);

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Items" }]} />
        <h2>Items</h2>
      </section>

      <section className="feat">
        <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name or id"
            style={{ padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 4, fontFamily: "inherit", minWidth: 220 }}
          />
          <select name="status" defaultValue={status} style={{ padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 4, fontFamily: "inherit" }}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="review">Review</option>
            <option value="live">Live</option>
          </select>
          <select name="tier" defaultValue={tier} style={{ padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 4, fontFamily: "inherit" }}>
            <option value="">All tiers</option>
            {Object.entries(TIER).map(([k, v]) => (
              <option key={k} value={k}>{v.name}</option>
            ))}
          </select>
          <button type="submit" className="btn">Filter</button>
          <Link href="/admin/items/new" className="btn primary" style={{ marginLeft: "auto" }}>New item</Link>
        </form>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "6px 8px" }}>Name</th>
              <th style={{ padding: "6px 8px" }}>Tier</th>
              <th style={{ padding: "6px 8px" }}>Kind</th>
              <th style={{ padding: "6px 8px" }}>Status</th>
              <th style={{ padding: "6px 8px" }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "6px 8px" }}>
                  <Link href={`/admin/items/${encodeURIComponent(r.id)}`}>{r.name}</Link>
                </td>
                <td style={{ padding: "6px 8px" }}>{TIER[r.tier].name}</td>
                <td style={{ padding: "6px 8px" }}>{r.kind}</td>
                <td style={{ padding: "6px 8px" }}>
                  <StatusPill status={r.status} />
                </td>
                <td style={{ padding: "6px 8px", color: "var(--muted)" }}>
                  {new Date(r.updatedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p style={{ color: "var(--muted)", marginTop: 16 }}>No items match.</p>}
      </section>
      <Footer />
    </main>
  );
}

function StatusPill({ status }: { status: ItemStatus }) {
  const colour =
    status === "live"
      ? "var(--good, #2a7a2a)"
      : status === "review"
        ? "var(--warn, #a66400)"
        : "var(--muted)";
  return (
    <span
      style={{
        fontFamily: "var(--mono, monospace)",
        fontSize: 11,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: colour,
        border: `1px solid ${colour}`,
        padding: "1px 6px",
        borderRadius: 3,
      }}
    >
      {status}
    </span>
  );
}
