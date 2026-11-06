import { desc } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { Breadcrumb } from "../Breadcrumb";
import { BannersAdmin, type BannerRow } from "./BannersAdmin";

export const dynamic = "force-dynamic";

export default async function AdminBannersPage() {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.siteBanners)
    .orderBy(desc(schema.siteBanners.createdAt));

  const initial: BannerRow[] = rows.map((r) => ({
    id: r.id,
    body: r.body,
    severity: r.severity,
    status: r.status,
    audience: r.audience,
    dismissible: r.dismissible,
    startsAt: r.startsAt ? r.startsAt.toISOString() : null,
    endsAt: r.endsAt ? r.endsAt.toISOString() : null,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Banners" }]} />
        <h2>Site banners</h2>
        <p>
          App-wide notices shown above the page. Many can be drafted; only one
          banner is live at a time. Publishing a draft automatically archives
          whichever banner was live before.
        </p>
      </section>

      <section className="feat" style={{ padding: 0 }}>
        <BannersAdmin initial={initial} />
      </section>

      <Footer />
    </main>
  );
}
