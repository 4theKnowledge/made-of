import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { getDb, schema } from "@/db/client";
import { getLiveSnapshot } from "@/graph/live";
import { buildThemeBundle } from "@/combine/data";
import type { DailyConfig } from "@/combine/daily-config";
import type { ThemeKey } from "@/combine/types";
import { Breadcrumb } from "../../../Breadcrumb";
import { validateTheme, type ValidatorInput } from "../validator";
import { DailyConfigEditor } from "./DailyConfigEditor";

export const dynamic = "force-dynamic";

export default async function AdminCombineThemeDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const themeCode = decodeURIComponent(code);
  const db = getDb();

  const [theme] = await db
    .select()
    .from(schema.combineThemes)
    .where(eq(schema.combineThemes.code, themeCode))
    .limit(1);
  if (!theme) return notFound();

  // Everything in the theme (ids + items).
  const memberRows = await db
    .select({ itemId: schema.itemCombineThemes.itemId })
    .from(schema.itemCombineThemes)
    .where(eq(schema.itemCombineThemes.themeCode, themeCode));
  const memberIds = new Set(memberRows.map((r) => r.itemId));

  // Load every item (we need their recipes' parts regardless of theme) and
  // every recipe + its outgoing f/w links. At 276/354 that's cheap.
  const items = await db
    .select({
      id: schema.items.id,
      name: schema.items.name,
      tags: schema.items.tags,
    })
    .from(schema.items);

  const recipes = await db
    .select({ id: schema.recipes.id, itemId: schema.recipes.itemId })
    .from(schema.recipes);

  const recipeIds = recipes.map((r) => r.id);
  const recipeLinks = recipeIds.length
    ? await db
        .select({
          recipeId: schema.links.recipeId,
          targetItemId: schema.links.targetItemId,
          type: schema.links.type,
        })
        .from(schema.links)
        .where(inArray(schema.links.recipeId, recipeIds))
    : [];

  // Build Validator inputs: parts = union of f and w per recipe.
  const partsByRecipe = new Map<string, Set<string>>();
  for (const l of recipeLinks) {
    if (!l.recipeId) continue;
    if (l.type !== "f" && l.type !== "w") continue;
    const set = partsByRecipe.get(l.recipeId) ?? new Set<string>();
    set.add(l.targetItemId);
    partsByRecipe.set(l.recipeId, set);
  }

  const input: ValidatorInput = {
    items: items.map((i) => ({ id: i.id, name: i.name, tags: i.tags })),
    recipes: recipes.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      parts: Array.from(partsByRecipe.get(r.id) ?? []),
    })),
    themeMembers: memberIds,
  };

  const report = validateTheme(input);

  // For member listing — sort alpha.
  const members = items
    .filter((it) => memberIds.has(it.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const health = report.broken.length === 0 ? "ok" : "broken";

  // Build a non-daily bundle just to surface the authored age count on the
  // daily-config editor. Non-critical — if the live snapshot fails we hide
  // the editor rather than crashing the page.
  let totalAges: number | null = null;
  try {
    const live = await getLiveSnapshot();
    totalAges = buildThemeBundle(live.snapshot, themeCode as ThemeKey).theme.ages.length;
  } catch {
    // keep null
  }
  const initialDaily = (theme.dailyConfig ?? null) as DailyConfig | null;

  return (
    <main className="wrap">
      <Header />
      <section className="phero">
        <Breadcrumb
          trail={[
            { label: "Admin", href: "/admin" },
            { label: "Combine themes", href: "/admin/combine/themes" },
            { label: theme.label },
          ]}
        />
        <h2>{theme.label}</h2>
        <p style={{ fontFamily: "var(--mono, monospace)", color: "var(--muted)" }}>{theme.code}</p>
        {theme.description && <p>{theme.description}</p>}
      </section>

      <section
        className="feat"
        style={{
          borderLeft: `4px solid ${health === "ok" ? "var(--good, #2a7a2a)" : "#f85149"}`,
        }}
      >
        <h3 style={{ marginTop: 0, fontSize: 16 }}>
          Validator ·{" "}
          {health === "ok" ? (
            <span style={{ color: "var(--good, #2a7a2a)" }}>passing</span>
          ) : (
            <span style={{ color: "#f85149" }}>{report.broken.length} broken item(s)</span>
          )}
        </h3>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", margin: 0, fontSize: 13 }}>
          <dt style={{ color: "var(--muted)" }}>Members</dt>
          <dd style={{ margin: 0 }}>{report.memberCount}</dd>
          <dt style={{ color: "var(--muted)" }}>Base ingredients</dt>
          <dd style={{ margin: 0 }}>
            {report.baseCount}
            <span style={{ color: "var(--muted)", marginLeft: 8 }}>
              (items in theme with no recipe — the game deals these directly)
            </span>
          </dd>
          <dt style={{ color: "var(--muted)" }}>Buildable</dt>
          <dd style={{ margin: 0 }}>
            {report.buildableCount} / {report.memberCount}
          </dd>
          <dt style={{ color: "var(--muted)" }}>Warnings</dt>
          <dd style={{ margin: 0 }}>{report.warnings.length}</dd>
        </dl>
      </section>

      {report.broken.length > 0 && (
        <section className="feat">
          <h3 style={{ marginTop: 0, fontSize: 16, color: "#f85149" }}>Broken items</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {report.broken.map((b) => (
              <li
                key={b.itemId}
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid var(--line)",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                }}
              >
                <div>
                  <strong>{b.name}</strong>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {b.reason.kind === "unreachable" ? (
                      <>
                        No recipe where every ingredient is in the theme. Closest recipe is missing:{" "}
                        <span style={{ fontFamily: "var(--mono, monospace)" }}>
                          {b.reason.missingDeps.length ? b.reason.missingDeps.join(", ") : "(no recipes)"}
                        </span>
                      </>
                    ) : (
                      <>Also tagged <code>combine-exclude</code>. The game would skip it; remove from this theme or drop the tag.</>
                    )}
                  </div>
                </div>
                <Link href={`/admin/items/${encodeURIComponent(b.itemId)}`} className="btn" style={{ fontSize: 12, alignSelf: "start" }}>
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.warnings.length > 0 && (
        <section className="feat">
          <h3 style={{ marginTop: 0, fontSize: 16, color: "var(--warn, #a66400)" }}>Warnings</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {report.warnings.map((w) => (
              <li key={w.itemId} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                <strong>{w.name}</strong>
                <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>
                  Base ingredient that no theme recipe uses — can be dealt but doesn&rsquo;t participate.
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {totalAges != null && (
        <section className="feat">
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Daily config</h3>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
            These knobs apply only when a player opens the daily puzzle for this theme.
            Endless and fast modes are unaffected.
          </p>
          <DailyConfigEditor themeCode={themeCode} initial={initialDaily} totalAges={totalAges} />
        </section>
      )}

      <section className="feat">
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Members ({members.length})</h3>
        {members.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No items in this theme yet.</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {members.map((m) => (
              <Link
                key={m.id}
                href={`/admin/items/${encodeURIComponent(m.id)}`}
                style={{
                  fontSize: 12,
                  padding: "2px 10px",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  color: "var(--ink)",
                  textDecoration: "none",
                }}
              >
                {m.name}
              </Link>
            ))}
          </div>
        )}
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
          Membership is edited from each item&apos;s Edit modal in the{" "}
          <Link href="/admin/tree">knowledge base</Link>.
        </p>
      </section>

      <Footer />
    </main>
  );
}
