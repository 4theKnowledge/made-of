import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { Pictogram } from "@/pictograms/Pictogram";
import { cap } from "@/lib/taxonomy";
import { getSession } from "@/lib/session";
import {
  loadAccountCollections,
  type ScopeCollection,
} from "@/lib/stats/collections";
import type { Tier } from "@/db/schema";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Collections · Made Of",
  description: "Everything you've discovered in Combine.",
  alternates: { canonical: "/account/collections" },
  robots: { index: false },
};

const TIER_LABELS: Record<Tier, string> = {
  F: "Fundamental",
  N: "Natural",
  M: "Material",
  C: "Component",
  P: "Product",
  S: "System",
};
const TIER_ORDER: readonly Tier[] = ["F", "N", "M", "C", "P", "S"] as const;

export default async function CollectionsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const collections = await loadAccountCollections(session.user.id);
  const nothingYet =
    collections.endless.total === 0 && collections.daily.total === 0;

  return (
    <main className="wrap">
      <Header />
      <div className="pricing">
        <section className="phero">
          <span className="eyebrow">
            <Link href="/account" style={{ color: "inherit" }}>
              Account
            </Link>{" "}
            · Collections
          </span>
          <h2>Your collections</h2>
          <p>
            Everything you&rsquo;ve discovered in Combine. Endless is shared
            across every endless theme; Daily is its own pool so each day
            starts fair.
          </p>
        </section>

        {nothingYet ? (
          <section className="feat">
            <p style={{ margin: 0, color: "var(--muted)" }}>
              No discoveries yet. Play <Link href="/combine">Combine</Link>{" "}
              and anything you find will show up here.
            </p>
          </section>
        ) : (
          <>
            <ScopeSection
              label="Endless"
              hint="Shared across endless themes."
              scope={collections.endless}
            />
            <ScopeSection
              label="Daily"
              hint="Separate pool for the daily puzzle."
              scope={collections.daily}
            />
          </>
        )}
      </div>
      <Footer />
    </main>
  );
}

function ScopeSection({
  label,
  hint,
  scope,
}: {
  label: string;
  hint: string;
  scope: ScopeCollection;
}) {
  return (
    <section className="feat">
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>{label}</h3>
          <p className="small" style={{ margin: 0 }}>
            {hint}
          </p>
        </div>
        <div
          style={{
            fontFamily:
              "var(--mono, 'Chivo Mono'), ui-monospace, monospace",
            fontSize: 22,
            lineHeight: 1.1,
          }}
          aria-label={`${scope.total} discovered`}
        >
          {scope.total}
          <small style={{ color: "var(--muted)", marginLeft: 6, fontSize: 13 }}>
            discovered
          </small>
        </div>
      </header>

      {scope.total === 0 ? (
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
          Nothing in this collection yet.
        </p>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
              gap: 12,
              marginTop: 4,
            }}
          >
            {TIER_ORDER.map((tier) => (
              <TierStat
                key={tier}
                label={TIER_LABELS[tier]}
                value={scope.byTier[tier]}
              />
            ))}
          </div>
          <ItemsGrid items={scope.items} />
        </>
      )}
    </section>
  );
}

function TierStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--mono, 'Chivo Mono'), ui-monospace, monospace",
          fontSize: 18,
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ItemsGrid({
  items,
}: {
  items: ScopeCollection["items"];
}) {
  return (
    <ul
      style={{
        listStyle: "none",
        padding: 0,
        margin: "8px 0 0",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
        gap: 10,
      }}
    >
      {items.map((it) => (
        <li key={`${it.itemId}`}>
          <Link
            href={`/i/${it.slug}`}
            title={`${cap(it.name)} · found ${fmtDate(it.firstFoundAt)}`}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              padding: "10px 6px",
              border: "1.5px solid var(--line)",
              borderRadius: 3,
              background: "var(--surface)",
              color: "var(--ink)",
              textDecoration: "none",
              minHeight: 110,
            }}
          >
            <Pictogram
              name={it.name}
              tier={it.tier}
              kind={it.kind}
              symbol={it.symbol}
              pictogram={it.pictogram}
            />
            <span
              style={{
                fontSize: 13,
                textAlign: "center",
                lineHeight: 1.2,
                fontWeight: 600,
              }}
            >
              {cap(it.name)}
            </span>
            <small
              style={{
                fontSize: 11,
                color: "var(--muted)",
                fontFamily:
                  "var(--mono, 'Chivo Mono'), ui-monospace, monospace",
              }}
            >
              {fmtDate(it.firstFoundAt)}
            </small>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
