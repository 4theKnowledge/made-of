import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { Pictogram } from "@/pictograms/Pictogram";
import { PICTO } from "@/pictograms/data";
import { ITEMS } from "@/data/items.data";
import type { ItemKind, Tier } from "@/db/schema";
import { Breadcrumb } from "../Breadcrumb";

export const dynamic = "force-dynamic";

const KIND_ORDER: ItemKind[] = [
  "cosmic",
  "element",
  "mineral",
  "substance",
  "living",
  "food",
  "part",
  "object",
  "tool",
  "place",
  "information",
  "energy",
];

export default function PictogramAuditPage() {
  const hasSpecific = new Set(Object.keys(PICTO));
  const byKind = new Map<ItemKind, typeof ITEMS>();
  for (const item of ITEMS) {
    const arr = byKind.get(item.kind) ?? [];
    arr.push(item);
    byKind.set(item.kind, arr);
  }
  for (const arr of byKind.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }

  const kinds = KIND_ORDER.filter((k) => byKind.has(k));

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Pictograms" }]} />
        <h2>Pictogram audit</h2>
        <p>
          Every item in the knowledge base, grouped by kind. Items marked{" "}
          <strong>fallback</strong> use their kind&apos;s default picto; everything
          else has a specific one in PICTO.
        </p>
      </section>

      {kinds.map((kind) => {
        const items = byKind.get(kind)!;
        const specifics = items.filter((i) => hasSpecific.has(i.name) || i.symbol);
        const fallbacks = items.filter((i) => !hasSpecific.has(i.name) && !i.symbol);
        return (
          <section className="feat" key={kind} style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>
              {kind}{" "}
              <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 14 }}>
                ({items.length} items — {specifics.length} specific, {fallbacks.length} fallback)
              </span>
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                gap: 12,
              }}
            >
              {items.map((item) => {
                const isFallback = !hasSpecific.has(item.name) && !item.symbol;
                return (
                  <div
                    key={item.name}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: 8,
                      borderRadius: 6,
                      border: isFallback
                        ? "1px dashed var(--muted)"
                        : "1px solid var(--line, rgba(0,0,0,0.08))",
                      background: isFallback ? "rgba(0,0,0,0.02)" : "transparent",
                    }}
                  >
                    <div style={{ transform: "scale(2.2)", transformOrigin: "center", margin: "16px 0 20px" }}>
                      <Pictogram
                        name={item.name}
                        tier={item.tier as Tier}
                        kind={item.kind}
                        symbol={item.symbol ?? null}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        textAlign: "center",
                        wordBreak: "break-word",
                        lineHeight: 1.2,
                      }}
                    >
                      {item.name}
                    </div>
                    {isFallback && (
                      <div style={{ fontSize: 9, color: "var(--muted)" }}>fallback</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <Footer />
    </main>
  );
}
