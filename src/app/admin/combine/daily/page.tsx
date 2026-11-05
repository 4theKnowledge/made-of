import { asc } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { getActiveDaily } from "@/combine/daily-config-db";
import { readSchedule } from "@/combine/daily-schedule-db";
import { Breadcrumb } from "../../Breadcrumb";
import { DailyAdmin, type ScheduleRow, type ThemeOption } from "./DailyAdmin";

export const dynamic = "force-dynamic";

/** Dedicated Combine → Daily admin page. Daily is a top-level gameplay
 *  mode, not a theme attribute; this page is where the admin chooses
 *  which theme hosts the daily, tunes the capped-run knobs, and reviews /
 *  regenerates the 30-day precomputed schedule. */
export default async function AdminCombineDailyPage() {
  const db = getDb();

  const themeRows = await db
    .select({ code: schema.combineThemes.code, label: schema.combineThemes.label })
    .from(schema.combineThemes)
    .orderBy(asc(schema.combineThemes.position), asc(schema.combineThemes.code));
  const themes: ThemeOption[] = themeRows.map((t) => ({ code: t.code, label: t.label }));

  const active = await getActiveDaily();
  const schedule: ScheduleRow[] = active ? await readSchedule(active.themeCode, 30) : [];

  // id → name map for guest rendering. We only need items referenced in
  // the schedule's guest lists, but loading the whole item name column is
  // cheap and keeps the component props simple.
  const items = await db
    .select({ id: schema.items.id, name: schema.items.name })
    .from(schema.items);
  const itemNamesById: Record<string, string> = {};
  for (const it of items) itemNamesById[it.id] = it.name;

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb
          trail={[
            { label: "Admin", href: "/admin" },
            { label: "Combine", href: "/admin/combine/themes" },
            { label: "Daily" },
          ]}
        />
        <h2>Combine · Daily</h2>
        <p style={{ color: "var(--muted)" }}>
          Pick which theme hosts the daily puzzle and tune its length + guest drip.
        </p>
      </section>
      <DailyAdmin
        themes={themes}
        initialActive={active}
        initialSchedule={schedule}
        itemNamesById={itemNamesById}
      />
      <Footer />
    </main>
  );
}
