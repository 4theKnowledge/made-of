import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/bulk/pictograms/template — a two-form worked example
 *  of the pictograms-only upload shape. Keys live in a top-level `_readme`
 *  block the uploader strips before processing. */
const TEMPLATE = {
  _readme: {
    purpose:
      "Upload pictograms only. Each entry is 'name → SVG inner-markup'. Resolves against existing items by name first, then kinds by code.",
    forms: [
      "Simple: a flat dict { \"iron\": \"<svg>\", \"copper\": \"<svg>\" }. Each key auto-resolves to item name OR kind code.",
      "Explicit: { \"items\": { \"iron\": \"<svg>\" }, \"kinds\": { \"mineral\": \"<svg>\" } }. Use this when you want to be unambiguous.",
    ],
    rules: [
      "Values are SVG inner-markup (no outer <svg> tag). 32×32 viewBox.",
      "Download /api/admin/bulk/pictogram-style for the authoring rules and worked examples.",
      "The uploader fills `pictogram` where the DB value is null by default. Where the DB already has a pictogram, you must explicitly choose 'overwrite' per entry.",
      "Keys that match neither an item name nor a kind code are flagged as orphans — add the item/kind first (via /admin/tree or /admin/kinds, or a bulk pack).",
    ],
  },

  // Pick one of the two forms below. Both are accepted.

  // Simple form (recommended for AI-generated batches by name):
  "iron": '<path class="b" d="M4 20l6-6h18v6l-6 6H4z"/><path class="l" d="M4 20h18M10 14l-6 6M22 20l6-6"/>',
  "copper": '<path class="b" d="M4 20l6-6h18v6l-6 6H4z"/><path class="l" d="M4 20h18M10 14l-6 6M22 20l6-6"/>',

  // Explicit form (uncomment if you prefer disambiguating items vs kinds):
  // "items": {
  //   "iron": "<svg inner-markup...>"
  // },
  // "kinds": {
  //   "mineral": "<svg inner-markup...>"
  // }
};

export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  return NextResponse.json(TEMPLATE, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="made-of-pictograms-template.json"`,
    },
  });
}
