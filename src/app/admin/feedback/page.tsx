import { desc } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { Breadcrumb } from "../Breadcrumb";
import { FeedbackAdmin, type FeedbackRow } from "./FeedbackAdmin";

export const dynamic = "force-dynamic";

export default async function AdminFeedbackPage() {
  const db = getDb();

  const rows = await db
    .select({
      id: schema.feedback.id,
      type: schema.feedback.type,
      payload: schema.feedback.payload,
      userId: schema.feedback.userId,
      url: schema.feedback.url,
      status: schema.feedback.status,
      adminNote: schema.feedback.adminNote,
      createdAt: schema.feedback.createdAt,
      updatedAt: schema.feedback.updatedAt,
    })
    .from(schema.feedback)
    .orderBy(desc(schema.feedback.createdAt));

  const initial: FeedbackRow[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: (r.payload as Record<string, unknown>) ?? {},
    userId: r.userId,
    url: r.url,
    status: r.status,
    adminNote: r.adminNote,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Feedback" }]} />
        <h2>Feedback</h2>
        <p>
          User-submitted feedback — item and recipe suggestions, broken-recipe
          reports, and general notes. Flip to <code>triaged</code> once reviewed,
          <code>resolved</code> when acted on, or <code>dismissed</code> for noise.
        </p>
      </section>

      <section className="feat" style={{ padding: 0 }}>
        <FeedbackAdmin initial={initial} />
      </section>

      <Footer />
    </main>
  );
}
