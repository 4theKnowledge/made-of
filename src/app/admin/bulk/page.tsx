import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { Breadcrumb } from "../Breadcrumb";
import { BulkForm } from "./BulkForm";
import { DownloadPanel } from "./DownloadPanel";

export const dynamic = "force-dynamic";

export default function AdminBulkPage() {
  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Bulk upload" }]} />
        <h2>Bulk upload</h2>
        <p>
          Add new items, recipes, links and evidence to the knowledge base in
          one shot. Additive — existing content is left alone unless you
          explicitly merge. Hand the snapshot (with schema) to an AI agent as
          context, then paste its output below.
        </p>
        <DownloadPanel />
      </section>
      <section className="feat">
        <BulkForm />
      </section>
      <Footer />
    </main>
  );
}
