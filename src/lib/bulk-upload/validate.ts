/**
 * Pure pack validators. Return a flat list of issues the planner then merges
 * with its DB-collision findings. Split out from plan.ts so the hard logic
 * is unit-testable without a DB round-trip.
 */

import { slug as toSlug, parseLinkId } from "@/data/load";
import type { BulkPack, Issue, KbIndex } from "./types";

const TIERS = new Set(["F", "N", "M", "C", "P", "S"]);
const LINK_TYPES_RECIPE = new Set(["f", "w", "n", "e"]);
const CONFIDENCES = new Set(["established", "strong", "debated", "hypothesis"]);
const STANCES = new Set(["supports", "contradicts"]);
const SOURCE_KINDS = new Set([
  "paper",
  "book",
  "review",
  "news",
  "government",
  "university",
  "museum",
  "industry",
  "encyclopedia",
]);

/** Normalise a name/slug to catch soft duplicates. Case-insensitive, strip
 *  non-alphanumeric. "Red Oak" and "red-oak" both collapse to "redoak". */
export function normaliseKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface SchemaResult {
  issues: Issue[];
  /** Items that survived schema validation. Items with hard schema errors
   *  are dropped so downstream passes don't trip over them. */
  validItems: BulkPack["items"];
  /** Same for evidence/source entries. */
  validEvidenceLinks: BulkPack["evidenceLinks"];
  validSources: BulkPack["sources"];
}

/** Pass 1 — schema/vocab validation per entry. Doesn't look across entries. */
export function validateSchema(pack: BulkPack, kb: KbIndex): SchemaResult {
  const issues: Issue[] = [];
  const validItems: BulkPack["items"] = [];
  const validEvidenceLinks: BulkPack["evidenceLinks"] = [];
  const validSources: BulkPack["sources"] = {};

  for (const it of pack.items ?? []) {
    const where = it?.name ?? "<unnamed>";
    if (typeof it?.name !== "string" || it.name.trim() === "") {
      issues.push({
        severity: "error",
        code: "item_missing_name",
        message: "Item is missing a name.",
        at: where,
      });
      continue;
    }
    if (!TIERS.has(it.tier)) {
      issues.push({
        severity: "error",
        code: "item_bad_tier",
        message: `Item "${it.name}" has an unknown tier "${it.tier}". Allowed: F, N, M, C, P, S.`,
        at: it.name,
      });
      continue;
    }
    if (!kb.existingKindCodes.has(it.kind)) {
      issues.push({
        severity: "error",
        code: "item_bad_kind",
        message: `Item "${it.name}" has unknown kind "${it.kind}". Add the kind first under /admin/kinds, or use an existing one.`,
        at: it.name,
      });
      continue;
    }
    for (const r of it.recipes ?? []) {
      // Recipe-level links must not include `s` — s is item-level only.
      for (const key of ["f", "w", "n", "e"] as const) {
        const list = r[key];
        if (list && !Array.isArray(list)) {
          issues.push({
            severity: "error",
            code: "recipe_bad_shape",
            message: `Item "${it.name}" has a non-array value for recipe.${key}.`,
            at: it.name,
          });
        }
      }
      // A stray `s` in a recipe is a common authoring mistake worth catching.
      if ((r as Record<string, unknown>).s !== undefined) {
        issues.push({
          severity: "error",
          code: "recipe_has_item_level_link",
          message: `Item "${it.name}" has an "s" (comes-from) key in a recipe. Move it to top-level linksS.`,
          at: it.name,
        });
      }
    }
    validItems.push(it);
  }

  for (const ev of pack.evidenceLinks ?? []) {
    if (!Array.isArray(ev?.ids) || ev.ids.length === 0) {
      issues.push({
        severity: "error",
        code: "evidence_no_ids",
        message: "Evidence entry has no `ids`.",
      });
      continue;
    }
    if (!CONFIDENCES.has(ev.confidence)) {
      issues.push({
        severity: "error",
        code: "evidence_bad_confidence",
        message: `Evidence confidence "${ev.confidence}" is not one of established, strong, debated, hypothesis.`,
        at: ev.ids[0],
      });
      continue;
    }
    let shapeOk = true;
    for (const id of ev.ids) {
      try {
        const parts = parseLinkId(id);
        if (!LINK_TYPES_RECIPE.has(parts.type) && parts.type !== "s") {
          issues.push({
            severity: "error",
            code: "evidence_bad_link_type",
            message: `Evidence id "${id}" uses unknown link type "${parts.type}".`,
            at: id,
          });
          shapeOk = false;
        }
      } catch {
        issues.push({
          severity: "error",
          code: "evidence_bad_id",
          message: `Evidence id "${id}" is malformed. Expected "child<type<parent".`,
          at: id,
        });
        shapeOk = false;
      }
    }
    for (const e of ev.evidence ?? []) {
      if (!STANCES.has(e.stance)) {
        issues.push({
          severity: "error",
          code: "evidence_entry_bad_stance",
          message: `Evidence stance "${e.stance}" is not supports|contradicts.`,
          at: ev.ids[0],
        });
        shapeOk = false;
      }
      if (typeof e.summary !== "string" || e.summary.trim() === "") {
        issues.push({
          severity: "error",
          code: "evidence_entry_no_summary",
          message: "Evidence entry is missing a summary.",
          at: ev.ids[0],
        });
        shapeOk = false;
      }
    }
    if (shapeOk) validEvidenceLinks.push(ev);
  }

  for (const [code, s] of Object.entries(pack.sources ?? {})) {
    if (!SOURCE_KINDS.has(s.kind)) {
      issues.push({
        severity: "error",
        code: "source_bad_kind",
        message: `Source "${code}" has unknown kind "${s.kind}".`,
        at: code,
      });
      continue;
    }
    if (typeof s.title !== "string" || s.title.trim() === "") {
      issues.push({
        severity: "error",
        code: "source_no_title",
        message: `Source "${code}" is missing a title.`,
        at: code,
      });
      continue;
    }
    validSources[code] = s;
  }

  return { issues, validItems, validEvidenceLinks, validSources };
}

/** Pass 2 — intra-pack duplicates and reference checks. Runs on the
 *  schema-validated subset. */
export function validateIntraPack(
  pack: BulkPack,
  kb: KbIndex,
): Issue[] {
  const issues: Issue[] = [];

  // Pack items by name/slug, so references can resolve either to pack
  // items or to KB items.
  const packNames = new Set<string>();
  const packSlugs = new Map<string, string>();
  for (const it of pack.items) {
    if (packNames.has(it.name)) {
      issues.push({
        severity: "error",
        code: "duplicate_name_in_pack",
        message: `Pack has two items named "${it.name}".`,
        at: it.name,
      });
    }
    packNames.add(it.name);

    const s = toSlug(it.name);
    const prior = packSlugs.get(s);
    if (prior && prior !== it.name) {
      issues.push({
        severity: "error",
        code: "duplicate_slug_in_pack",
        message: `Pack items "${prior}" and "${it.name}" both have slug "${s}".`,
        at: it.name,
      });
    }
    packSlugs.set(s, it.name);
  }

  // A name resolves if either the pack or the KB has it.
  const resolveName = (name: string): boolean =>
    packNames.has(name) || kb.itemByName.has(name);

  // Check every recipe ingredient and item-level link target.
  for (const it of pack.items) {
    for (const r of it.recipes ?? []) {
      for (const key of ["f", "w", "n", "e"] as const) {
        for (const target of r[key] ?? []) {
          if (!resolveName(target)) {
            issues.push({
              severity: "error",
              code: "unresolved_recipe_ingredient",
              message: `Item "${it.name}" references unknown ingredient "${target}" in recipe.${key}.`,
              at: it.name,
            });
          }
        }
      }
    }
    for (const target of it.linksN ?? []) {
      if (!resolveName(target)) {
        issues.push({
          severity: "error",
          code: "unresolved_linksN",
          message: `Item "${it.name}" references unknown item "${target}" in linksN.`,
          at: it.name,
        });
      }
    }
    for (const target of it.linksS ?? []) {
      if (!resolveName(target)) {
        issues.push({
          severity: "error",
          code: "unresolved_linksS",
          message: `Item "${it.name}" references unknown item "${target}" in linksS.`,
          at: it.name,
        });
      }
    }
  }

  // Evidence ids: resolve child and parent names against the union of
  // pack and KB items. Unresolved ids are warnings (the apply step will
  // skip them, consistent with runImport semantics) not errors.
  for (const ev of pack.evidenceLinks) {
    for (const id of ev.ids) {
      let parts;
      try {
        parts = parseLinkId(id);
      } catch {
        continue; // already reported in schema pass
      }
      if (!resolveName(parts.childName)) {
        issues.push({
          severity: "warning",
          code: "evidence_unknown_child",
          message: `Evidence id "${id}" references unknown item "${parts.childName}" (child). The evidence row will be skipped.`,
          at: id,
        });
      }
      if (!resolveName(parts.parentName)) {
        issues.push({
          severity: "warning",
          code: "evidence_unknown_parent",
          message: `Evidence id "${id}" references unknown item "${parts.parentName}" (parent). The evidence row will be skipped.`,
          at: id,
        });
      }
    }
    // Every source referenced by an evidence entry must either be in the
    // pack or already in the DB.
    for (const e of ev.evidence ?? []) {
      for (const src of e.sources ?? []) {
        if (!(src in pack.sources) && !kb.existingSourceCodes.has(src)) {
          issues.push({
            severity: "error",
            code: "unknown_source",
            message: `Evidence references unknown source "${src}". Add it under \`sources\` or make sure the code matches an existing one.`,
            at: ev.ids[0],
          });
        }
      }
    }
  }

  return issues;
}
