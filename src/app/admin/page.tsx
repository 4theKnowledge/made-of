import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { Breadcrumb } from "./Breadcrumb";

export const dynamic = "force-dynamic";

type ToolGroup = {
  title: string;
  blurb: string;
  tools: { href: string; label: string; download?: boolean }[];
};

const GROUPS: ToolGroup[] = [
  {
    title: "Content",
    blurb: "Items, kinds, and bulk edits to the knowledge base.",
    tools: [
      { href: "/admin/tree", label: "Knowledge base" },
      { href: "/admin/kinds", label: "Kinds" },
      { href: "/admin/import", label: "Import JSON" },
      { href: "/admin/bulk", label: "Bulk upload" },
    ],
  },
  {
    title: "Combine",
    blurb: "Theme membership and the daily puzzle.",
    tools: [
      { href: "/admin/combine/themes", label: "Themes" },
      { href: "/admin/combine/daily", label: "Daily" },
    ],
  },
  {
    title: "Media",
    blurb: "Pictogram coverage and uploads.",
    tools: [
      { href: "/admin/pictograms", label: "Pictogram audit" },
      { href: "/admin/pictograms/upload", label: "Pictogram upload" },
    ],
  },
  {
    title: "Ops",
    blurb: "Access, announcements, feedback, and exports.",
    tools: [
      { href: "/admin/codes", label: "Invite codes" },
      { href: "/admin/banners", label: "Site banners" },
      { href: "/admin/changelog", label: "Changelog" },
      { href: "/admin/feedback", label: "Feedback" },
      { href: "/admin/debug", label: "Debug" },
      { href: "/api/admin/export", label: "Download export", download: true },
    ],
  },
];

export default async function AdminHome() {
  const db = getDb();
  const [[allItems], [draftItems], [reviewItems], [canaryLinks]] = await Promise.all([
    db.select({ n: count() }).from(schema.items),
    db.select({ n: count() }).from(schema.items).where(eq(schema.items.status, "draft")),
    db.select({ n: count() }).from(schema.items).where(eq(schema.items.status, "review")),
    db.select({ n: count() }).from(schema.links).where(eq(schema.links.isCanary, true)),
  ]);

  const stats = [
    { label: "Items", value: allItems.n },
    { label: "Drafts", value: draftItems.n },
    { label: "In review", value: reviewItems.n },
    { label: "Canary links", value: canaryLinks.n },
  ];

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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
          }}
        >
          {stats.map((s) => (
            <div
              key={s.label}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 3,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 28, lineHeight: 1 }}>
                {s.value}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
        }}
      >
        {GROUPS.map((g) => (
          <section key={g.title} className="feat">
            <h3 style={{ marginTop: 0 }}>{g.title}</h3>
            <p className="small">{g.blurb}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "auto" }}>
              {g.tools.map((t) =>
                t.download ? (
                  <a key={t.href} href={t.href} className="btn" download>
                    {t.label}
                  </a>
                ) : (
                  <Link key={t.href} href={t.href} className="btn">
                    {t.label}
                  </Link>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
      <Footer />
    </main>
  );
}
