import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { Breadcrumb } from "../../Breadcrumb";
import { PictogramUploadForm } from "./PictogramUploadForm";

export const dynamic = "force-dynamic";

export default function PictogramUploadPage() {
  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb
          trail={[
            { label: "Admin", href: "/admin" },
            { label: "Pictograms", href: "/admin/pictograms" },
            { label: "Upload" },
          ]}
        />
        <h2>Pictogram upload</h2>
        <p>
          Upload pictograms as a <code>{"{ name: svg }"}</code> dict. Keys
          resolve against item names first, then kind codes. Entries whose
          target already has a pictogram require an explicit overwrite.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
          <a href="/api/admin/bulk/pictograms/template" className="btn" download>
            Download pictograms template
          </a>
          <a href="/api/admin/bulk/pictogram-style" className="btn" download>
            Download style guide
          </a>
        </div>
      </section>
      <section className="feat">
        <PictogramUploadForm />
      </section>
      <Footer />
    </main>
  );
}
