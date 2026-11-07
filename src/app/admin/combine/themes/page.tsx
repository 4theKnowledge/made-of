import Link from "next/link";
import { asc, count, eq } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { Breadcrumb } from "../../Breadcrumb";
import { ThemesAdmin, type ThemeRow } from "./ThemesAdmin";

export const dynamic = "force-dynamic";

export default async function AdminCombineThemesPage() {
  const db = getDb();

  const themes = await db
    .select()
    .from(schema.combineThemes)
    .orderBy(asc(schema.combineThemes.position), asc(schema.combineThemes.code));

  const counts = await db
    .select({ themeCode: schema.itemCombineThemes.themeCode, n: count() })
    .from(schema.itemCombineThemes)
    .groupBy(schema.itemCombineThemes.themeCode);
  const countByTheme = new Map(counts.map((c) => [c.themeCode, c.n]));

  // Fetch each theme's broken-count so the list surfaces failing themes.
  // Running the validator here would double-fetch items/recipes; keep this
  // page cheap and show the health badge only on the detail page.
  void eq;

  const rows: ThemeRow[] = themes.map((t) => ({
    code: t.code,
    label: t.label,
    description: t.description,
    position: t.position,
    itemCount: countByTheme.get(t.code) ?? 0,
    isPublished: t.isPublished,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Combine themes" }]} />
        <h2>Combine themes</h2>
        <p>
          A theme is a curated subset of items playable together. Each item in a theme must be buildable from the
          theme&rsquo;s base ingredients — the validator on each theme page checks this.
        </p>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          Daily config (which theme hosts today&apos;s daily, caps, guest items, 30-day schedule) lives on the{" "}
          <Link href="/admin/combine/daily">Combine daily</Link> page.
        </p>
      </section>

      <section className="feat" style={{ padding: 0 }}>
        <ThemesAdmin initial={rows} />
      </section>

      <section className="feat">
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
          Edit an item&apos;s theme memberships from the{" "}
          <Link href="/admin/tree">knowledge base</Link> — open an item and toggle themes in the Edit modal.
        </p>
      </section>

      <Footer />
    </main>
  );
}
