import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { ImportForm } from "./ImportForm";
import { Breadcrumb } from "../Breadcrumb";

export const dynamic = "force-dynamic";

export default function AdminImportPage() {
  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Import" }]} />
        <h2>Import JSON</h2>
        <p>
          Paste a <code>Data*</code>-shape payload — the same shape the Export
          endpoint produces, matching <code>src/data/types.ts</code>. The
          import <strong>replaces</strong> the knowledge base from the payload;
          canary links are reapplied. Dry-run shows stats without touching the
          DB.
        </p>
      </section>
      <section className="feat">
        <ImportForm />
      </section>
      <Footer />
    </main>
  );
}
