"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Tier, ItemKind } from "@/db/schema";
import { computeClosure, isClosureEnabled, type ClosureConfig } from "@/combine/closure";
import type { RecipePartType } from "@/combine/parts";
import { validateTheme, type ValidatorRecipe, type ValidatorResult } from "../validator";

export interface BuilderItem {
  id: string;
  name: string;
  slug: string;
  tier: Tier;
  kind: ItemKind;
  status: "draft" | "review" | "live";
  tags: string[];
  isCombineExcluded: boolean;
}

/** Recipe shape passed in by the server — aligned parts + partTypes so the
 *  client can run both the validator (parts only) and the closure
 *  (partTypes needed for followLinkTypes). */
export interface BuilderRecipe extends ValidatorRecipe {
  partTypes?: RecipePartType[];
}

export type MemberSource = "manual" | "closure";

export interface BuilderProps {
  themeCode: string;
  themeLabel: string;
  initialMemberIds: string[];
  /** Per-member source from DB. Missing entries default to 'manual'. */
  initialMemberSources: Record<string, string>;
  initialClosureConfig: ClosureConfig | null;
  items: BuilderItem[];
  /** Pre-filtered to playable recipes only (see src/combine/parts.ts). */
  recipes: BuilderRecipe[];
  availableTiers: Tier[];
  availableKinds: ItemKind[];
  availableTags: string[];
}

interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
}

const TIER_LABELS: Record<Tier, string> = {
  F: "F · Primordial",
  N: "N · Natural",
  M: "M · Mixed",
  C: "C · Crafted",
  P: "P · Processed",
  S: "S · Synthetic",
};

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `request_failed_${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) msg = body.message;
      else if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export function ThemeBuilder(props: BuilderProps) {
  const { themeCode, themeLabel, items, recipes, availableTiers, availableKinds, availableTags } = props;

  const itemById = useMemo(() => {
    const m = new Map<string, BuilderItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const [members, setMembers] = useState<Set<string>>(() => new Set(props.initialMemberIds));
  const [memberSources, setMemberSources] = useState<Map<string, MemberSource>>(() => {
    const m = new Map<string, MemberSource>();
    for (const id of props.initialMemberIds) {
      const s = props.initialMemberSources[id];
      m.set(id, s === "closure" ? "closure" : "manual");
    }
    return m;
  });
  const [closureConfig, setClosureConfig] = useState<ClosureConfig | null>(props.initialClosureConfig);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  // Everything needed to run the closure client-side (preview without
  // round-trip). Mirrors what loadGraphForClosure returns on the server.
  const closureItems = useMemo(
    () =>
      items.map((i) => ({
        id: i.id,
        tier: i.tier,
        kind: i.kind,
        tags: i.tags,
        isCombineExcluded: i.isCombineExcluded,
      })),
    [items],
  );
  const closureRecipes = useMemo(
    () =>
      recipes.map((r) => ({
        id: r.id,
        itemId: r.itemId,
        parts: r.parts,
        partTypes: r.partTypes,
      })),
    [recipes],
  );

  const toast = useCallback((text: string, kind: Toast["kind"] = "error") => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  // Validator — re-runs on every member change using the already-loaded
  // items + playable recipes. ~350 items × a few hundred recipes is cheap.
  const report: ValidatorResult = useMemo(
    () =>
      validateTheme({
        items: items.map((i) => ({ id: i.id, name: i.name, isCombineExcluded: i.isCombineExcluded })),
        recipes,
        themeMembers: members,
      }),
    [items, recipes, members],
  );

  // Candidate filters.
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | "">("");
  const [kind, setKind] = useState<ItemKind | "">("");
  const [tag, setTag] = useState<string>("");
  const [hideExcluded, setHideExcluded] = useState(true);
  const [sort, setSort] = useState<"name" | "tier">("name");

  const normQ = q.trim().toLowerCase();

  const nonMembers = useMemo(() => items.filter((it) => !members.has(it.id)), [items, members]);

  const filteredCandidates = useMemo(() => {
    let list = nonMembers;
    if (hideExcluded) list = list.filter((i) => !i.isCombineExcluded);
    if (tier) list = list.filter((i) => i.tier === tier);
    if (kind) list = list.filter((i) => i.kind === kind);
    if (tag) list = list.filter((i) => i.tags.includes(tag));
    if (normQ) {
      list = list.filter((i) => i.name.includes(normQ) || i.slug.includes(normQ));
    }
    if (sort === "name") {
      list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    } else {
      const tierOrder: Record<Tier, number> = { F: 0, N: 1, M: 2, C: 3, P: 4, S: 5 };
      list = list
        .slice()
        .sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || a.name.localeCompare(b.name));
    }
    return list;
  }, [nonMembers, hideExcluded, tier, kind, tag, normQ, sort]);

  const { manualMembers, closureMembers } = useMemo(() => {
    const manual: BuilderItem[] = [];
    const closure: BuilderItem[] = [];
    for (const id of members) {
      const it = itemById.get(id);
      if (!it) continue;
      if (memberSources.get(id) === "closure") closure.push(it);
      else manual.push(it);
    }
    const cmp = (a: BuilderItem, b: BuilderItem) => a.name.localeCompare(b.name);
    manual.sort(cmp);
    closure.sort(cmp);
    return { manualMembers: manual, closureMembers: closure };
  }, [members, itemById, memberSources]);

  // Mutations — optimistic + rollback on failure. When applyClosure=false
  // we tell the server to skip closure expansion (used when the client has
  // already previewed and confirmed the expanded set).
  const mutate = useCallback(
    async (change: { add?: string[]; remove?: string[]; applyClosure?: boolean }) => {
      const add = change.add ?? [];
      const remove = change.remove ?? [];
      if (!add.length && !remove.length) return;

      const previous = members;
      const next = new Set(members);
      for (const id of add) next.add(id);
      for (const id of remove) next.delete(id);
      setMembers(next);

      try {
        const result = await send<{
          members: string[];
          memberSources: Record<string, string>;
        }>(`/api/admin/combine-themes/${encodeURIComponent(themeCode)}/members`, {
          method: "POST",
          body: JSON.stringify({
            add,
            remove,
            applyClosure: change.applyClosure !== false,
          }),
        });
        setMembers(new Set(result.members));
        const newSources = new Map<string, MemberSource>();
        for (const [id, s] of Object.entries(result.memberSources ?? {})) {
          newSources.set(id, s === "closure" ? "closure" : "manual");
        }
        setMemberSources(newSources);
      } catch (e) {
        setMembers(previous);
        const msg = e instanceof Error ? e.message : String(e);
        toast(`Save failed: ${msg}`);
      }
    },
    [members, themeCode, toast],
  );

  // Promote a closure-sourced item to manual so it persists through
  // config changes.
  const promote = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      // Optimistic flip.
      setMemberSources((prev) => {
        const next = new Map(prev);
        for (const id of ids) next.set(id, "manual");
        return next;
      });
      try {
        await send(`/api/admin/combine-themes/${encodeURIComponent(themeCode)}/promote`, {
          method: "POST",
          body: JSON.stringify({ itemIds: ids }),
        });
      } catch (e) {
        toast(`Promote failed: ${e instanceof Error ? e.message : String(e)}`);
        // Revert: refetch sources on next member operation; not critical here.
      }
    },
    [themeCode, toast],
  );

  // Add path: if closure is enabled, compute the hypothetical closure
  // client-side first. If it would add nothing beyond the requested items,
  // commit directly. If it adds a few (≤ threshold), commit + toast. If
  // more, show a confirmation modal listing what would land.
  const ADD_CONFIRM_THRESHOLD = 10;
  const [addConfirm, setAddConfirm] = useState<{
    requested: string[];
    extras: { id: string; name: string; tier: string }[];
  } | null>(null);

  const requestAdd = useCallback(
    (ids: string[]) => {
      const dedup = Array.from(new Set(ids.filter((id) => !members.has(id))));
      if (dedup.length === 0) return;

      if (!isClosureEnabled(closureConfig)) {
        void mutate({ add: dedup });
        return;
      }

      // Preview client-side.
      const seeds = new Set<string>(members);
      for (const id of dedup) seeds.add(id);
      const result = computeClosure({
        items: closureItems,
        recipes: closureRecipes,
        seeds,
        config: closureConfig ?? {},
      });
      const extras: { id: string; name: string; tier: string }[] = [];
      for (const id of result.members) {
        if (members.has(id)) continue;
        if (dedup.includes(id)) continue;
        const it = itemById.get(id);
        if (!it) continue;
        extras.push({ id, name: it.name, tier: it.tier });
      }
      extras.sort((a, b) => a.name.localeCompare(b.name));

      if (extras.length === 0) {
        void mutate({ add: dedup });
        return;
      }
      if (extras.length <= ADD_CONFIRM_THRESHOLD) {
        // Small enough — add silently and toast the delta.
        const allToAdd = Array.from(new Set([...dedup, ...extras.map((e) => e.id)]));
        void mutate({ add: allToAdd, applyClosure: false }).then(() => {
          toast(`Added ${dedup.length} + ${extras.length} auto-included dep${extras.length === 1 ? "" : "s"}.`, "info");
        });
        return;
      }
      // Big — ask first.
      setAddConfirm({ requested: dedup, extras });
    },
    [members, closureConfig, closureItems, closureRecipes, itemById, mutate, toast],
  );

  const addOne = (id: string) => requestAdd([id]);
  const removeOne = (id: string) => void mutate({ remove: [id] });
  const addAllFiltered = () => requestAdd(filteredCandidates.map((i) => i.id));

  // Paste-to-add modal.
  const [pasteOpen, setPasteOpen] = useState(false);

  // Persistent full-theme preview: what would the theme contain if the
  // current closure config were applied to the current member set right now?
  const closurePreview = useMemo(() => {
    if (!isClosureEnabled(closureConfig)) return null;
    return computeClosure({
      items: closureItems,
      recipes: closureRecipes,
      seeds: members,
      config: closureConfig ?? {},
    });
  }, [closureConfig, closureItems, closureRecipes, members]);

  const applyClosureNow = useCallback(async () => {
    if (!closurePreview) return;
    const add = closurePreview.added.filter((id) => !members.has(id));
    if (!add.length) {
      toast("Theme already matches closure.", "info");
      return;
    }
    await mutate({ add, applyClosure: false });
    toast(`Applied closure: +${add.length} items.`, "info");
  }, [closurePreview, members, mutate, toast]);

  return (
    <>
      {/* Two-pane grid collapses to stacked on narrow screens so the
          builder is usable on a phone. */}
      <style>{`
        .themeBuilderGrid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 0;
        }
        .themeBuilderGrid > :first-child { border-right: 1px solid var(--line); }
        @media (max-width: 720px) {
          .themeBuilderGrid { grid-template-columns: minmax(0, 1fr); }
          .themeBuilderGrid > :first-child {
            border-right: 0;
            border-bottom: 1px solid var(--line);
          }
        }
        .themeBuilderChip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 4px 3px 10px;
          border-radius: 999px;
          font-size: 12px;
          background: var(--surface);
        }
      `}</style>
      <ClosureConfigStrip
        config={closureConfig}
        availableTiers={availableTiers}
        availableKinds={availableKinds}
        availableTags={availableTags}
        itemById={itemById}
        preview={closurePreview}
        onChange={(c) => setClosureConfig(c)}
        onSave={async (c) => {
          try {
            await send(`/api/admin/combine-themes/${encodeURIComponent(themeCode)}`, {
              method: "PATCH",
              body: JSON.stringify({ closure_config: c }),
            });
            toast(c === null ? "Auto-chain disabled." : "Auto-chain settings saved.", "info");
          } catch (e) {
            toast(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }}
        onApplyNow={applyClosureNow}
      />

      <ValidatorStrip report={report} />

      <section className="feat" style={{ padding: 0 }}>
        <div className="themeBuilderGrid">
          <MembersPane
            label={themeLabel}
            manual={manualMembers}
            closure={closureMembers}
            onRemove={removeOne}
            onPromote={(id) => void promote([id])}
            onPromoteAll={() => void promote(closureMembers.map((m) => m.id))}
            onOpenPaste={() => setPasteOpen(true)}
          />
          <CandidatesPane
            items={filteredCandidates}
            totalNonMembers={nonMembers.length}
            q={q}
            setQ={setQ}
            tier={tier}
            setTier={setTier}
            availableTiers={availableTiers}
            kind={kind}
            setKind={setKind}
            availableKinds={availableKinds}
            tag={tag}
            setTag={setTag}
            availableTags={availableTags}
            hideExcluded={hideExcluded}
            setHideExcluded={setHideExcluded}
            sort={sort}
            setSort={setSort}
            onAdd={addOne}
            onAddAll={addAllFiltered}
          />
        </div>
      </section>

      {pasteOpen && (
        <PasteModal
          themeCode={themeCode}
          existingMembers={members}
          onCancel={() => setPasteOpen(false)}
          onConfirm={async (ids) => {
            setPasteOpen(false);
            requestAdd(ids);
          }}
          onError={toast}
        />
      )}

      {addConfirm && (
        <AddConfirmModal
          requestedCount={addConfirm.requested.length}
          extras={addConfirm.extras}
          onCancel={() => setAddConfirm(null)}
          onConfirm={async () => {
            const allToAdd = [...addConfirm.requested, ...addConfirm.extras.map((e) => e.id)];
            setAddConfirm(null);
            await mutate({ add: allToAdd, applyClosure: false });
            toast(`Added ${addConfirm.requested.length} + ${addConfirm.extras.length} auto-included.`, "info");
          }}
        />
      )}

      {toasts.length > 0 && (
        <div style={toastStack}>
          {toasts.map((t) => (
            <div
              key={t.id}
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
              style={{
                ...toastBox,
                background: t.kind === "error" ? "var(--bad)" : "var(--surface)",
                color: t.kind === "error" ? "#fff" : "var(--ink)",
              }}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Validator strip
 * ------------------------------------------------------------------ */

function ValidatorStrip({ report }: { report: ValidatorResult }) {
  const health = report.broken.length === 0 ? "ok" : "broken";
  return (
    <section
      className="feat"
      style={{
        borderLeft: `4px solid ${health === "ok" ? "var(--good)" : "var(--bad)"}`,
      }}
    >
      <h3 style={{ marginTop: 0, fontSize: 16 }}>
        Validator ·{" "}
        {health === "ok" ? (
          <span style={{ color: "var(--good)" }}>passing</span>
        ) : (
          <span style={{ color: "var(--bad)" }}>{report.broken.length} broken item(s)</span>
        )}
      </h3>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", margin: 0, fontSize: 13 }}>
        <dt style={{ color: "var(--muted)" }}>Members</dt>
        <dd style={{ margin: 0 }}>{report.memberCount}</dd>
        <dt style={{ color: "var(--muted)" }}>Dealt-only</dt>
        <dd style={{ margin: 0 }}>
          {report.baseCount}
          <span style={{ color: "var(--muted)", marginLeft: 8 }}>
            (members with no playable recipe — dealt directly, never produced)
          </span>
        </dd>
        <dt style={{ color: "var(--muted)" }}>Buildable</dt>
        <dd style={{ margin: 0 }}>
          {report.buildableCount} / {report.memberCount}
        </dd>
        <dt style={{ color: "var(--muted)" }}>Warnings</dt>
        <dd style={{ margin: 0 }}>{report.warnings.length}</dd>
      </dl>

      {report.broken.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", color: "var(--bad)", fontSize: 13 }}>
            {report.broken.length} broken — expand
          </summary>
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
            {report.broken.map((b) => (
              <li
                key={b.itemId}
                style={{
                  padding: "6px 0",
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
                        No playable recipe with every ingredient in the theme. Closest recipe needs:{" "}
                        <span style={{ fontFamily: "var(--mono)" }}>
                          {b.reason.missingDeps.length ? b.reason.missingDeps.join(", ") : "(no recipes)"}
                        </span>
                      </>
                    ) : (
                      <>
                        Flagged <code>isCombineExcluded</code>. The game would skip it; either remove from this theme
                        or clear the exclude flag on the item.
                      </>
                    )}
                  </div>
                </div>
                <Link
                  href={`/admin/items/${encodeURIComponent(b.itemId)}`}
                  className="btn"
                  style={{ fontSize: 12, alignSelf: "start" }}
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      {report.warnings.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: "pointer", color: "var(--warn)", fontSize: 13 }}>
            {report.warnings.length} warning(s) — expand
          </summary>
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
            {report.warnings.map((w) => (
              <li key={w.itemId} style={{ padding: "4px 0", fontSize: 13 }}>
                <strong>{w.name}</strong>
                <span style={{ color: "var(--muted)", marginLeft: 8 }}>
                  Dealt base ingredient that no theme recipe uses — rides along but can&apos;t combine.
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Members pane (left)
 * ------------------------------------------------------------------ */

function MembersPane({
  label,
  manual,
  closure,
  onRemove,
  onPromote,
  onPromoteAll,
  onOpenPaste,
}: {
  label: string;
  manual: BuilderItem[];
  closure: BuilderItem[];
  onRemove: (id: string) => void;
  onPromote: (id: string) => void;
  onPromoteAll: () => void;
  onOpenPaste: () => void;
}) {
  const total = manual.length + closure.length;
  return (
    <div style={{ minHeight: 400 }}>
      <div style={paneHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: 14 }}>In theme</strong>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {total} in <em>{label}</em>
          </span>
        </div>
        <button type="button" className="btn" style={smallBtn} onClick={onOpenPaste}>
          Paste to add
        </button>
      </div>

      {total === 0 && (
        <div style={{ padding: 24, color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
          No items yet. Add some from the candidates pane.
        </div>
      )}

      {manual.length > 0 && (
        <MembersSection
          title="Manual"
          hint="Items you explicitly added — the theme's primary content."
          color="var(--ink)"
          items={manual}
          chipBorder={(it) => (it.isCombineExcluded ? "var(--bad)" : "var(--ink)")}
          chipBg={() => "var(--surface)"}
          chipWeight={600}
          onRemove={onRemove}
        />
      )}

      {closure.length > 0 && (
        <MembersSection
          title="Auto-included"
          hint="Pulled in by auto-chain to make the theme buildable. Promote to keep if you change settings."
          color="var(--accent)"
          items={closure}
          chipBorder={(it) =>
            it.isCombineExcluded
              ? "var(--bad)"
              : "color-mix(in srgb, var(--accent) 50%, var(--line))"
          }
          chipBg={() => "color-mix(in srgb, var(--accent) 7%, var(--surface))"}
          chipWeight={400}
          actionLabel="Pin"
          actionHint="Promote to Manual so it survives config changes"
          onAction={onPromote}
          onRemove={onRemove}
          headerExtras={
            <button type="button" className="btn" style={smallBtn} onClick={onPromoteAll}>
              Promote all to manual
            </button>
          }
        />
      )}
    </div>
  );
}

function MembersSection({
  title,
  hint,
  color,
  items,
  chipBorder,
  chipBg,
  chipWeight,
  actionLabel,
  actionHint,
  onAction,
  onRemove,
  headerExtras,
}: {
  title: string;
  hint: string;
  color: string;
  items: BuilderItem[];
  chipBorder: (it: BuilderItem) => string;
  chipBg: (it: BuilderItem) => string;
  chipWeight: number;
  actionLabel?: string;
  actionHint?: string;
  onAction?: (id: string) => void;
  onRemove: (id: string) => void;
  headerExtras?: React.ReactNode;
}) {
  return (
    <div style={{ padding: "6px 14px 10px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 6,
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 12, color, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {title} ({items.length})
        </strong>
        <span style={{ fontSize: 11, color: "var(--muted)", flex: 1, minWidth: 0 }}>{hint}</span>
        {headerExtras}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map((m) => (
          <li key={m.id}>
            <span
              className="themeBuilderChip"
              style={{
                border: `1px solid ${chipBorder(m)}`,
                background: chipBg(m),
                fontWeight: chipWeight,
              }}
              title={m.isCombineExcluded ? "Flagged isCombineExcluded" : undefined}
            >
              <span style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 10 }}>{m.tier}</span>
              <Link
                href={`/admin/items/${encodeURIComponent(m.id)}`}
                style={{ color: "var(--ink)", textDecoration: "none" }}
              >
                {m.name}
              </Link>
              {actionLabel && onAction && (
                <button
                  type="button"
                  aria-label={`${actionLabel} ${m.name}`}
                  onClick={() => onAction(m.id)}
                  title={actionHint}
                  style={{
                    border: "1px solid var(--line)",
                    background: "transparent",
                    color: "var(--ink)",
                    cursor: "pointer",
                    fontSize: 10,
                    borderRadius: 3,
                    padding: "0 6px",
                  }}
                >
                  {actionLabel}
                </button>
              )}
              <button
                type="button"
                aria-label={`Remove ${m.name}`}
                onClick={() => onRemove(m.id)}
                style={xBtn}
              >
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Candidates pane (right)
 * ------------------------------------------------------------------ */

function CandidatesPane({
  items,
  totalNonMembers,
  q,
  setQ,
  tier,
  setTier,
  availableTiers,
  kind,
  setKind,
  availableKinds,
  tag,
  setTag,
  availableTags,
  hideExcluded,
  setHideExcluded,
  sort,
  setSort,
  onAdd,
  onAddAll,
}: {
  items: BuilderItem[];
  totalNonMembers: number;
  q: string;
  setQ: (v: string) => void;
  tier: Tier | "";
  setTier: (v: Tier | "") => void;
  availableTiers: Tier[];
  kind: ItemKind | "";
  setKind: (v: ItemKind | "") => void;
  availableKinds: ItemKind[];
  tag: string;
  setTag: (v: string) => void;
  availableTags: string[];
  hideExcluded: boolean;
  setHideExcluded: (v: boolean) => void;
  sort: "name" | "tier";
  setSort: (v: "name" | "tier") => void;
  onAdd: (id: string) => void;
  onAddAll: () => void;
}) {
  const filtersActive = !!(q || tier || kind || tag || !hideExcluded);
  const cap = 300;
  const shown = items.slice(0, cap);

  return (
    <div style={{ minHeight: 400 }}>
      <div style={paneHeader}>
        <strong style={{ fontSize: 14 }}>Candidates</strong>
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8, flex: 1 }}>
          {items.length} of {totalNonMembers} not in theme{items.length > cap ? ` · showing first ${cap}` : ""}
        </span>
        <button
          type="button"
          className="btn"
          style={smallBtn}
          disabled={!filtersActive || items.length === 0}
          onClick={onAddAll}
          title={
            filtersActive
              ? `Add all ${items.length} filtered items to this theme`
              : "Narrow with filters first to enable bulk add"
          }
        >
          Add all filtered ({items.length})
        </button>
      </div>

      <div style={filterRow}>
        <input
          placeholder="Search name or slug…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...filterInput, flex: "1 1 180px" }}
        />
        <select value={tier} onChange={(e) => setTier(e.target.value as Tier | "")} style={filterInput}>
          <option value="">All tiers</option>
          {availableTiers.map((t) => (
            <option key={t} value={t}>
              {TIER_LABELS[t]}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as ItemKind | "")} style={filterInput}>
          <option value="">All kinds</option>
          {availableKinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)} style={filterInput}>
          <option value="">All tags</option>
          {availableTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as "name" | "tier")} style={filterInput}>
          <option value="name">Sort: name</option>
          <option value="tier">Sort: tier</option>
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <input type="checkbox" checked={hideExcluded} onChange={(e) => setHideExcluded(e.target.checked)} />
          Hide excluded
        </label>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 520, overflowY: "auto" }}>
        {shown.length === 0 && (
          <li style={{ padding: 24, color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
            No items match. Loosen filters or clear search.
          </li>
        )}
        {shown.map((it) => (
          <li
            key={it.id}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto auto",
              gap: 10,
              alignItems: "center",
              padding: "6px 14px",
              borderBottom: "1px solid var(--line)",
              fontSize: 13,
            }}
          >
            <span style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 11, width: 14 }}>
              {it.tier}
            </span>
            <Link
              href={`/admin/items/${encodeURIComponent(it.id)}`}
              style={{ color: "var(--ink)", textDecoration: "none" }}
            >
              {it.name}
            </Link>
            <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>{it.kind}</span>
            <button
              type="button"
              className="btn"
              style={smallBtn}
              onClick={() => onAdd(it.id)}
              disabled={it.isCombineExcluded}
              title={
                it.isCombineExcluded
                  ? "Item is flagged isCombineExcluded — clear the flag on the item first"
                  : "Add to theme"
              }
            >
              +
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Paste-to-add modal
 * ------------------------------------------------------------------ */

function PasteModal({
  themeCode,
  existingMembers,
  onCancel,
  onConfirm,
  onError,
}: {
  themeCode: string;
  existingMembers: Set<string>;
  onCancel: () => void;
  onConfirm: (itemIds: string[]) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{
    matched: { input: string; itemId: string; name: string }[];
    unmatched: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const resolve = async () => {
    const names = text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) return;
    setBusy(true);
    try {
      const res = await send<{
        matched: { input: string; itemId: string; name: string }[];
        unmatched: string[];
      }>(`/api/admin/combine-themes/${encodeURIComponent(themeCode)}/resolve`, {
        method: "POST",
        body: JSON.stringify({ names }),
      });
      setPreview(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onError(`Resolve failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const toAdd = preview
    ? preview.matched.filter((m) => !existingMembers.has(m.itemId))
    : [];
  const alreadyIn = preview
    ? preview.matched.filter((m) => existingMembers.has(m.itemId))
    : [];

  return (
    <div style={modalBackdrop} onClick={onCancel}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Paste items to add</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          One per line (or comma-separated). Matches item names or slugs — case-insensitive.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={"water\niron\nwheat flour"}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: 8,
            fontFamily: "var(--mono)",
            fontSize: 13,
            border: "1px solid var(--line)",
            borderRadius: 3,
            background: "var(--card, var(--surface))",
            color: "var(--ink)",
          }}
        />

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button type="button" className="btn" onClick={resolve} disabled={busy || !text.trim()}>
            {busy ? "…" : preview ? "Re-resolve" : "Resolve"}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          {preview && (
            <button
              type="button"
              className="btn primary"
              disabled={toAdd.length === 0}
              onClick={() => onConfirm(toAdd.map((m) => m.itemId))}
            >
              Add {toAdd.length} item{toAdd.length === 1 ? "" : "s"}
            </button>
          )}
        </div>

        {preview && (
          <div style={{ marginTop: 14, fontSize: 13 }}>
            <PreviewSection
              label={`To add (${toAdd.length})`}
              color="var(--good)"
              items={toAdd.map((m) => m.name)}
            />
            {alreadyIn.length > 0 && (
              <PreviewSection
                label={`Already in theme (${alreadyIn.length})`}
                color="var(--muted)"
                items={alreadyIn.map((m) => m.name)}
              />
            )}
            {preview.unmatched.length > 0 && (
              <PreviewSection
                label={`Unmatched (${preview.unmatched.length})`}
                color="var(--bad)"
                items={preview.unmatched}
                mono
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewSection({
  label,
  color,
  items,
  mono,
}: {
  label: string;
  color: string;
  items: string[];
  mono?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ color, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          fontFamily: mono ? "var(--mono)" : undefined,
          fontSize: 12,
        }}
      >
        {items.map((n) => (
          <span
            key={n}
            style={{
              padding: "2px 8px",
              border: "1px solid var(--line)",
              borderRadius: 10,
              background: "var(--surface)",
            }}
          >
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Closure config strip + full-theme preview panel
 * ------------------------------------------------------------------ */

const LINK_TYPES: { v: RecipePartType; label: string }[] = [
  { v: "f", label: "made from (f)" },
  { v: "w", label: "made with (w)" },
  { v: "n", label: "needs (n)" },
  { v: "e", label: "evolved from (e)" },
];

function ClosureConfigStrip({
  config,
  availableTiers,
  availableKinds,
  availableTags,
  itemById,
  preview,
  onChange,
  onSave,
  onApplyNow,
}: {
  config: ClosureConfig | null;
  availableTiers: Tier[];
  availableKinds: ItemKind[];
  availableTags: string[];
  itemById: Map<string, BuilderItem>;
  preview: {
    members: Set<string>;
    added: string[];
    stoppedAt: string[];
    blockedByExcluded: string[];
  } | null;
  onChange: (c: ClosureConfig | null) => void;
  onSave: (c: ClosureConfig | null) => Promise<void>;
  onApplyNow: () => void;
}) {
  const enabled = isClosureEnabled(config);
  const [open, setOpen] = useState(enabled);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Dirty detection — compare current config to last-saved. The server
  // doesn't push us notifications, so we trust the last successful save.
  const [savedConfig, setSavedConfig] = useState<ClosureConfig | null>(config);
  const dirty = JSON.stringify(savedConfig) !== JSON.stringify(config);

  const update = (patch: Partial<ClosureConfig>) => {
    const next: ClosureConfig = { ...(config ?? {}), ...patch };
    // Strip empty arrays / undefined to keep the payload minimal.
    const clean: ClosureConfig = {};
    if (next.stopAtTiers && next.stopAtTiers.length) clean.stopAtTiers = next.stopAtTiers;
    if (next.stopAtKinds && next.stopAtKinds.length) clean.stopAtKinds = next.stopAtKinds;
    if (next.stopAtTags && next.stopAtTags.length) clean.stopAtTags = next.stopAtTags;
    if (next.followLinkTypes && next.followLinkTypes.length && next.followLinkTypes.length < 4) {
      clean.followLinkTypes = next.followLinkTypes;
    }
    if (typeof next.maxDepth === "number") clean.maxDepth = next.maxDepth;
    onChange(clean);
  };

  const toggleTier = (t: Tier) => {
    const cur = new Set(config?.stopAtTiers ?? []);
    if (cur.has(t)) cur.delete(t);
    else cur.add(t);
    update({ stopAtTiers: [...cur] });
  };
  const toggleKind = (k: ItemKind) => {
    const cur = new Set(config?.stopAtKinds ?? []);
    if (cur.has(k)) cur.delete(k);
    else cur.add(k);
    update({ stopAtKinds: [...cur] });
  };
  const toggleTag = (t: string) => {
    const cur = new Set(config?.stopAtTags ?? []);
    if (cur.has(t)) cur.delete(t);
    else cur.add(t);
    update({ stopAtTags: [...cur] });
  };
  const toggleLinkType = (t: RecipePartType) => {
    const defaults: RecipePartType[] = ["f", "w", "n", "e"];
    const cur = new Set<RecipePartType>(config?.followLinkTypes ?? defaults);
    if (cur.has(t)) cur.delete(t);
    else cur.add(t);
    update({ followLinkTypes: [...cur] });
  };

  const disable = async () => {
    setSaving(true);
    try {
      await onSave(null);
      setSavedConfig(null);
      onChange(null);
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(config);
      setSavedConfig(config);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="feat" style={{ borderLeft: `4px solid ${enabled ? "var(--accent)" : "var(--line)"}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Auto-include</h3>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {enabled
            ? "Adding a seed also adds every dependency up to your stop rules."
            : "Off — add items manually. Turn on to have the editor pull in ingredients."}
        </span>
        <span style={{ flex: 1 }} />
        {!enabled && (
          <button
            type="button"
            className="btn"
            onClick={async () => {
              onChange({});
              setOpen(true);
            }}
          >
            Enable
          </button>
        )}
        {enabled && (
          <button
            type="button"
            className="btn"
            style={{ fontSize: 12 }}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Collapse" : "Expand"}
          </button>
        )}
      </div>

      {enabled && open && (
        <div style={{ marginTop: 12, display: "grid", gap: 10, fontSize: 13 }}>
          <div>
            <div style={configLabel}>Stop at tiers (items on these tiers join as dealt-base; recursion halts)</div>
            <div style={chipRow}>
              {availableTiers.map((t) => {
                const on = config?.stopAtTiers?.includes(t) ?? false;
                return (
                  <button key={t} type="button" style={chip(on)} onClick={() => toggleTier(t)}>
                    {TIER_LABELS[t]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={configLabel}>Stop at kinds (items of these kinds act as dealt-base)</div>
            <div style={chipRow}>
              {availableKinds.length === 0 && (
                <span style={{ color: "var(--muted)", fontSize: 12 }}>No kinds defined yet.</span>
              )}
              {availableKinds.map((k) => {
                const on = config?.stopAtKinds?.includes(k) ?? false;
                return (
                  <button key={k} type="button" style={chip(on)} onClick={() => toggleKind(k)}>
                    {k}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={configLabel}>Stop at tags (any item with these tags acts as dealt-base)</div>
            <div style={chipRow}>
              {availableTags.length === 0 && (
                <span style={{ color: "var(--muted)", fontSize: 12 }}>No tags defined yet.</span>
              )}
              {availableTags.map((t) => {
                const on = config?.stopAtTags?.includes(t) ?? false;
                return (
                  <button key={t} type="button" style={chip(on)} onClick={() => toggleTag(t)}>
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={configLabel}>Follow link types (unchecked types are skipped when chaining)</div>
            <div style={chipRow}>
              {LINK_TYPES.map(({ v, label }) => {
                const defaults: RecipePartType[] = ["f", "w", "n", "e"];
                const current = config?.followLinkTypes ?? defaults;
                const on = current.includes(v);
                return (
                  <button key={v} type="button" style={chip(on)} onClick={() => toggleLinkType(v)}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>Max depth (blank = unlimited):</span>
              <input
                type="number"
                min={0}
                value={config?.maxDepth ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (v === "") {
                    const { maxDepth, ...rest } = config ?? {};
                    void maxDepth;
                    onChange(Object.keys(rest).length ? (rest as ClosureConfig) : {});
                  } else {
                    const n = Number.parseInt(v, 10);
                    if (Number.isFinite(n) && n >= 0) update({ maxDepth: n });
                  }
                }}
                style={{ width: 60, padding: "3px 6px", border: "1px solid var(--line)", borderRadius: 3, background: "var(--surface)", color: "var(--ink)" }}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn primary" onClick={save} disabled={saving || !dirty}>
              {saving ? "…" : dirty ? "Save settings" : "Saved"}
            </button>
            <button type="button" className="btn" onClick={disable} disabled={saving}>
              Disable auto-chain
            </button>
            <span style={{ flex: 1 }} />
            {preview && (
              <button type="button" className="btn" onClick={() => setPreviewOpen((v) => !v)} style={{ fontSize: 12 }}>
                {previewOpen ? "Hide preview" : `Preview full theme (${preview.members.size} items)`}
              </button>
            )}
          </div>
        </div>
      )}

      {enabled && preview && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: "var(--soft)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <strong>Full-theme preview</strong>
            <span>
              <code>{preview.members.size}</code> total · <code>{preview.added.length}</code> would be auto-added ·{" "}
              <code>{preview.stoppedAt.length}</code> stopped ·{" "}
              <code>{preview.blockedByExcluded.length}</code> blocked
            </span>
            <span style={{ flex: 1 }} />
            {preview.added.length > 0 && (
              <button type="button" className="btn primary" style={{ fontSize: 12 }} onClick={onApplyNow}>
                Apply closure now (+{preview.added.length})
              </button>
            )}
          </div>

          {previewOpen && (
            <div style={{ marginTop: 10 }}>
              {preview.added.length > 0 && (
                <NamedPreviewBlock label="Would be auto-added" ids={preview.added} itemById={itemById} color="var(--good)" />
              )}
              {preview.stoppedAt.length > 0 && (
                <NamedPreviewBlock
                  label="Stopped at (dealt-base)"
                  ids={preview.stoppedAt}
                  itemById={itemById}
                  color="var(--muted)"
                />
              )}
              {preview.blockedByExcluded.length > 0 && (
                <NamedPreviewBlock
                  label="Blocked by isCombineExcluded"
                  ids={preview.blockedByExcluded}
                  itemById={itemById}
                  color="var(--bad)"
                />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function NamedPreviewBlock({
  label,
  ids,
  itemById,
  color,
}: {
  label: string;
  ids: string[];
  itemById: Map<string, BuilderItem>;
  color: string;
}) {
  if (ids.length === 0) return null;
  const named = ids
    .map((id) => ({ id, name: itemById.get(id)?.name ?? id, tier: itemById.get(id)?.tier ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ color, fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
        {label} ({ids.length})
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, fontSize: 12 }}>
        {named.map((n) => (
          <span
            key={n.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 8px",
              border: "1px solid var(--line)",
              borderRadius: 10,
              background: "var(--surface)",
            }}
          >
            <span style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 10 }}>{n.tier}</span>
            {n.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Add-confirm modal (big closure expansions)
 * ------------------------------------------------------------------ */

function AddConfirmModal({
  requestedCount,
  extras,
  onCancel,
  onConfirm,
}: {
  requestedCount: number;
  extras: { id: string; name: string; tier: string }[];
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const byTier = new Map<string, { id: string; name: string }[]>();
  for (const e of extras) {
    const list = byTier.get(e.tier) ?? [];
    list.push(e);
    byTier.set(e.tier, list);
  }
  const tiers = [...byTier.keys()].sort();

  return (
    <div style={modalBackdrop} onClick={onCancel}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Confirm auto-chain</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          You&rsquo;re adding {requestedCount} item{requestedCount === 1 ? "" : "s"}. Auto-chain will also pull in{" "}
          <strong style={{ color: "var(--ink)" }}>{extras.length}</strong> dependenc
          {extras.length === 1 ? "y" : "ies"} so every item in the theme is buildable.
        </p>
        <div style={{ maxHeight: 360, overflowY: "auto", margin: "10px 0", fontSize: 12 }}>
          {tiers.map((tier) => (
            <div key={tier} style={{ marginBottom: 8 }}>
              <div style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 11, marginBottom: 4 }}>
                tier {tier} ({byTier.get(tier)!.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {byTier.get(tier)!.map((e) => (
                  <span
                    key={e.id}
                    style={{
                      padding: "2px 8px",
                      border: "1px solid var(--line)",
                      borderRadius: 10,
                      background: "var(--surface)",
                    }}
                  >
                    {e.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "…" : `Add ${requestedCount + extras.length} items`}
          </button>
        </div>
      </div>
    </div>
  );
}

const configLabel: React.CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
};
const chipRow: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4 };
const chip = (on: boolean): React.CSSProperties => ({
  padding: "3px 10px",
  fontSize: 12,
  borderRadius: 999,
  border: `1px solid ${on ? "var(--ink)" : "var(--line)"}`,
  background: on ? "var(--ink)" : "var(--surface)",
  color: on ? "var(--bg)" : "var(--ink)",
  cursor: "pointer",
});

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const paneHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  borderBottom: "1px solid var(--line)",
  background: "var(--soft)",
};

const filterRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  padding: "10px 14px",
  borderBottom: "1px solid var(--line)",
};

const filterInput: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  border: "1px solid var(--line)",
  borderRadius: 3,
  background: "var(--surface)",
  color: "var(--ink)",
  minWidth: 0,
  maxWidth: "100%",
};

const smallBtn: React.CSSProperties = { fontSize: 11, padding: "2px 8px" };

const xBtn: React.CSSProperties = {
  border: 0,
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
  padding: "0 4px",
};

const toastStack: React.CSSProperties = {
  position: "fixed",
  bottom: 16,
  right: 16,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  zIndex: 100,
};

const toastBox: React.CSSProperties = {
  border: "1.5px solid var(--ink)",
  borderRadius: 3,
  boxShadow: "2px 2px 0 var(--ink)",
  padding: "8px 12px",
  fontSize: 13,
  cursor: "pointer",
  maxWidth: 320,
};

const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 200,
  padding: 16,
};

const modalBox: React.CSSProperties = {
  background: "var(--surface)",
  border: "1.5px solid var(--ink)",
  borderRadius: 4,
  boxShadow: "4px 4px 0 var(--ink)",
  padding: 20,
  width: "min(600px, 100%)",
  maxHeight: "90vh",
  overflowY: "auto",
};
