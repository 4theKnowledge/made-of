import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { Breadcrumb } from "../Breadcrumb";
import { DebugActions } from "./DebugActions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Debug · Admin · Made Of",
  robots: { index: false, follow: false },
};

export default function AdminDebugPage() {
  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb trail={[{ label: "Admin", href: "/admin" }, { label: "Debug" }]} />
        <h2>Debug</h2>
        <p>Test-fire client UX that normally only appears on specific conditions.</p>
      </section>

      <section className="feat" style={{ padding: 16 }}>
        <DebugActions />
      </section>

      <Footer />
    </main>
  );
}
