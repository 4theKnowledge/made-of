import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import type { ChangelogType } from "@/db/schema";
import { renderMarkdown } from "@/lib/changelog/markdown";

export const dynamic = "force-dynamic";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Changelog · Made Of",
  description: "What's new on Made Of.",
  alternates: { canonical: "/changelog" },
};

const TYPE_LABELS: Record<ChangelogType, string> = {
  feature: "Feature",
  fix: "Fix",
  content: "Content",
  note: "Note",
};

const TYPE_COLORS: Record<ChangelogType, string> = {
  feature: "#2da44e",
  fix: "#bf3989",
  content: "#0969da",
  note: "#656d76",
};

export default async function ChangelogPage() {
  const db = getDb();

  const entries = await db
    .select({
      id: schema.changelogEntries.id,
      slug: schema.changelogEntries.slug,
      title: schema.changelogEntries.title,
      type: schema.changelogEntries.type,
      body: schema.changelogEntries.body,
      publishedAt: schema.changelogEntries.publishedAt,
    })
    .from(schema.changelogEntries)
    .where(eq(schema.changelogEntries.status, "live"))
    .orderBy(
      desc(schema.changelogEntries.publishedAt),
      desc(schema.changelogEntries.createdAt),
    );

  return (
    <main className="wrap">
      <Header />

      <div className="pricing">
        <section className="phero">
          <span className="eyebrow">Changelog</span>
          <h2>What&rsquo;s new</h2>
          <p>Notable changes to Made Of, newest first.</p>
        </section>

        {entries.length === 0 ? (
          <section className="feat">
            <p style={{ color: "var(--muted)" }}>
              Nothing published yet. Check back soon.
            </p>
          </section>
        ) : (
          <section className="feat" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {entries.map((entry) => (
              <article key={entry.id} id={entry.slug} style={{ scrollMarginTop: 80 }}>
                <header
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "baseline",
                    flexWrap: "wrap",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 7px",
                      background: TYPE_COLORS[entry.type],
                      color: "#fff",
                      borderRadius: 3,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    {TYPE_LABELS[entry.type]}
                  </span>
                  <h3 style={{ margin: 0 }}>
                    <a
                      href={`#${entry.slug}`}
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      {entry.title}
                    </a>
                  </h3>
                  {entry.publishedAt && (
                    <time
                      dateTime={entry.publishedAt.toISOString()}
                      style={{ color: "var(--muted)", fontSize: 13 }}
                    >
                      {entry.publishedAt.toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </time>
                  )}
                </header>
                {entry.body && (
                  <div
                    className="changelog-body"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.body) }}
                  />
                )}
              </article>
            ))}
          </section>
        )}
      </div>

      <Footer />
    </main>
  );
}
