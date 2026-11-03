import Link from "next/link";
import { desc } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { Breadcrumb } from "../Breadcrumb";
import { ChangelogAdmin, type ChangelogRow } from "./ChangelogAdmin";

export const dynamic = "force-dynamic";

export default async function AdminChangelogPage() {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.changelogEntries)
    .orderBy(desc(schema.changelogEntries.createdAt));

  const initial: ChangelogRow[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    type: r.type,
    body: r.body,
    status: r.status,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Changelog" }]} />
        <h2>Changelog</h2>
        <p>
          Release notes shown at <Link href="/changelog">/changelog</Link>. Only entries with status{" "}
          <code>live</code> are public. Flipping a draft to live stamps its publish date; flipping
          it back leaves the date in place.
        </p>
      </section>

      <section className="feat" style={{ padding: 0 }}>
        <ChangelogAdmin initial={initial} />
      </section>

      <Footer />
    </main>
  );
}
