import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { NewItemForm } from "./NewItemForm";
import { Breadcrumb } from "../../Breadcrumb";

export const dynamic = "force-dynamic";

export default function NewItemPage() {
  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb
          trail={[
            { label: "Admin", href: "/admin" },
            { label: "Items", href: "/admin/items" },
            { label: "New" },
          ]}
        />
        <h2>Create item</h2>
        <p>Lands as a draft. Add recipes/links from the item page or via import.</p>
      </section>
      <section className="feat">
        <NewItemForm />
      </section>
      <Footer />
    </main>
  );
}
