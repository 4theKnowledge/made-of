import { desc, eq, sql } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { invitesRequired } from "@/lib/auth";
import { Breadcrumb } from "../Breadcrumb";
import { CodesManager } from "./CodesManager";

export const dynamic = "force-dynamic";

export default async function AdminCodes() {
  const db = getDb();
  const rows = await db
    .select({
      code: schema.codes.code,
      kind: schema.codes.kind,
      maxUses: schema.codes.maxUses,
      uses: schema.codes.uses,
      expiresAt: schema.codes.expiresAt,
      note: schema.codes.note,
      createdAt: schema.codes.createdAt,
      redemptions: sql<number>`(
        select count(*)::int from ${schema.codeRedemptions}
        where ${schema.codeRedemptions.code} = ${schema.codes.code}
      )`,
    })
    .from(schema.codes)
    .orderBy(desc(schema.codes.createdAt));

  // Serialise dates so they survive the client-component boundary.
  const codes = rows.map((r) => ({
    ...r,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

  const activeInvites = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.codes)
    .where(eq(schema.codes.kind, "invite"));

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb
          trail={[{ label: "Admin", href: "/admin" }, { label: "Codes" }]}
        />
        <h2>Invite &amp; promo codes</h2>
        <p>
          Codes gate sign-up during soft-launch and double as a header for
          future promo use.{" "}
          {invitesRequired() ? (
            <>
              The sign-in form <b>requires</b> an invite for new accounts
              (<code>INVITES_REQUIRED=1</code>).
            </>
          ) : (
            <>
              The sign-in form is currently open; invites are accepted but
              not required (set <code>INVITES_REQUIRED=1</code> to gate).
            </>
          )}
        </p>
      </section>
      <section className="feat">
        <h3 style={{ marginTop: 0 }}>Overview</h3>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "8px 16px",
            margin: 0,
          }}
        >
          <dt style={{ color: "var(--muted)" }}>Codes total</dt>
          <dd style={{ margin: 0 }}>{activeInvites[0]?.n ?? 0}</dd>
        </dl>
      </section>
      <section className="feat">
        <CodesManager initial={codes} />
      </section>
      <Footer />
    </main>
  );
}
