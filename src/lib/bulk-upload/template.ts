/**
 * The bulk-upload pack template and the shared `_readme` builder.
 *
 * `BULK_UPLOAD_TEMPLATE` is served from /api/admin/bulk/template as a worked
 * example of the pack format. Agents are better at copying examples than at
 * reading JSON schemas, so every field appears at least once with a
 * representative value, and the top-level `_readme` block explains the
 * rules in prose.
 *
 * `buildReadme()` is the single source of truth for the vocabulary (tiers,
 * link types, kinds, confidences, …) and field schema. The template embeds
 * it, and the bulk snapshot endpoint can also embed it when the admin asks
 * for an agent-ready download. Keep vocab additions in one place.
 *
 * The `_readme` field is ignored by the planner — it exists purely for the
 * author (human or AI) consuming the pack.
 */

/** Variants of the `_readme` block. `template` targets the worked-example
 *  pack (talks about authoring NEW items). `snapshot` targets a KB dump
 *  (talks about reading existing items as reference). `snapshot-compact`
 *  is the same as `snapshot` but notes the missing evidence/sources so
 *  the agent doesn't hallucinate rules about them. */
export type ReadmeVariant = "template" | "snapshot" | "snapshot-compact";

const VOCAB = {
  tiers: ["F", "N", "M", "C", "P", "S"],
  linkTypesRecipe: ["f", "w", "n", "e"],
  linkTypesItem: ["n", "s"],
  linkTypeMeanings: {
    f: "made from / goes into — recipe-scoped",
    w: "made with / tools — recipe-scoped",
    n: "needs / needed by — recipe-scoped OR item-level",
    e: "evolved from / evolved into — recipe-scoped",
    s: "comes from / source of — ITEM-LEVEL ONLY, never in a recipe",
  },
  confidences: ["established", "strong", "debated", "hypothesis"],
  stances: ["supports", "contradicts"],
  sourceKinds: [
    "paper",
    "book",
    "review",
    "news",
    "government",
    "university",
    "museum",
    "industry",
    "encyclopedia",
  ],
  kinds: [
    "cosmic",
    "element",
    "mineral",
    "living",
    "substance",
    "food",
    "energy",
    "part",
    "object",
    "tool",
    "place",
    "information",
  ],
} as const;

const ITEM_SCHEMA = {
  name: "string (required). Lowercase display name, may contain spaces (e.g. 'big bang'). Slug is derived automatically.",
  tier: "string (required). One of F, N, M, C, P, S.",
  kind: "string (required). One of _readme.vocab.kinds, or a kind introduced by this pack under top-level `kinds`.",
  firstAppeared: "string (optional). Year in the format described under _readme.firstAppearedFormat.",
  symbol: "string | null (optional). Short display symbol if the item has one (chemical symbol, abbreviation).",
  fact: "string | null (optional). One or two factual sentences that would read well on an item page.",
  pictogram: "string | null (optional). SVG inner-markup, no outer <svg>. 32×32 viewBox; allowlisted elements/classes only. Fetch /api/admin/bulk/pictogram-style before writing one.",
  tags: "string[] (optional). Free-form membership markers. Omit when empty.",
  recipes: "Recipe[] (optional). An item may have multiple. Each recipe is {label?, f?: string[], w?: string[], n?: string[], e?: string[]}. Target items referenced by their exact `name`. Drop a key when its list is empty.",
  linksN: "string[] (optional). Item-level needs — target names.",
  linksS: "string[] (optional). Item-level 'comes from' — target names.",
  isCombineExcluded: "boolean (optional). Keep this item out of every Combine theme (safety net). Omit for false.",
} as const;

const COMMON_RULES: string[] = [
  "`name` is the lowercase display name (may contain spaces, e.g. 'big bang'). The slug is derived automatically.",
  "To reference an item that already exists in the KB, use its exact `name`. Names are the stable identifier agents use.",
  "An item may have multiple recipes. Each recipe lists `f` (made from), `w` (made with / tools), `n` (needs), `e` (evolved from). Drop a key when its list is empty.",
  "Item-level links use `linksN` (needs) and `linksS` (comes from). `s` is item-level only — NEVER put it in a recipe.",
  "Legal `tier` values: F, N, M, C, P, S. Legal `kind` values are listed under _readme.vocab.kinds (fetch /api/admin/kinds for live list).",
  "Set `isCombineExcluded: true` to keep an item out of every Combine theme. Omit for false.",
];

const TEMPLATE_RULES: string[] = [
  "Evidence links reference the links they describe by id of the form `child<type<parent`, e.g. `RNA<f<nucleotides` means 'RNA is made from nucleotides'.",
  "Every source referenced in an evidence entry must either be defined under `sources` in this pack or already exist in the KB by its code.",
  "Do not restate items that already exist. If you need to add a recipe to an existing item, include the item in `items` with just the new recipe — the planner will offer a merge.",
  "Legal `confidence` values: established, strong, debated, hypothesis. Legal `stance` values: supports, contradicts.",
  "`pictogram` is an SVG inner-markup string (no outer <svg> tag). 32×32 viewBox, allowlisted elements and classes only. Download /api/admin/bulk/pictogram-style for the authoring rules and worked examples before writing one.",
  "To introduce a new `kind`, add it under top-level `kinds` with its fallback `pictogram`. Items can then reference it from `kind`.",
];

const SNAPSHOT_COMPACT_NOTE =
  "This is a COMPACT snapshot — `pictogram` SVGs, `evidenceLinks` and `sources` are omitted to keep the payload small. If the pack you author needs those, download the full snapshot or the template.";

export interface Readme {
  purpose: string;
  rules: string[];
  itemSchema: typeof ITEM_SCHEMA;
  vocab: typeof VOCAB;
  firstAppearedFormat: string;
}

/** Build the `_readme` block for a given variant. The vocab + item schema
 *  are constant across variants; purpose and rules differ. */
export function buildReadme(variant: ReadmeVariant): Readme {
  const purpose =
    variant === "template"
      ? "Additive content pack for Made Of. Describes NEW items, recipes, links, evidence and sources to add to the knowledge base. Not a full replace — items you don't list are left alone."
      : variant === "snapshot-compact"
        ? "Live snapshot of the Made Of knowledge base, compact form. Use this as reference when authoring a bulk-upload pack: the item universe, recipe shapes and link usage are real."
        : "Live snapshot of the Made Of knowledge base. Round-trippable through /api/admin/bulk — useful as a backup and as agent reference.";

  const rules: string[] = [...COMMON_RULES];
  if (variant === "template") rules.push(...TEMPLATE_RULES);
  if (variant === "snapshot-compact") rules.push(SNAPSHOT_COMPACT_NOTE);

  return {
    purpose,
    rules,
    itemSchema: ITEM_SCHEMA,
    vocab: VOCAB,
    firstAppearedFormat:
      "Year string. Use '13.8bya' (billions), '400mya' (millions), '12ka' (thousands), '1994' (CE year), '-3500' (BCE). Prefix with '~' for 'about'.",
  };
}

export const BULK_UPLOAD_TEMPLATE = {
  _readme: buildReadme("template"),

  items: [
    {
      name: "example mineral",
      tier: "N",
      kind: "mineral",
      firstAppeared: "~4.5bya",
      symbol: null,
      fact: "A short, factual sentence or two that would read well on an item page.",
      pictogram:
        '<path class="b" d="M4 24l3-9 7-6 8 2 6 8-2 6z"/><path class="l" d="M14 9l2 8 10 2M16 17l-6 8"/>',
      tags: [],
      recipes: [
        {
          label: null,
          f: ["silicon", "oxygen"],
          w: [],
          n: ["heat"],
          e: [],
        },
      ],
      linksN: [],
      linksS: ["earth"],
    },
    {
      name: "example lean item",
      tier: "C",
      kind: "object",
      fact: "Only required fields present. Optional fields can be omitted entirely.",
    },
  ],

  kinds: {
    "example-kind": {
      label: "Example kind",
      description: "A newly introduced kind, with a fallback pictogram used by any item of this kind that doesn't override.",
      pictogram:
        '<circle class="b" cx="16" cy="16" r="10"/><path class="l" d="M16 6v20M6 16h20"/>',
    },
  },

  evidenceLinks: [
    {
      ids: ["example mineral<f<silicon", "example mineral<f<oxygen"],
      confidence: "established",
      note: "Short admin-facing note about why this link is well supported.",
      evidence: [
        {
          type: "mineralogical",
          stance: "supports",
          summary:
            "A one-sentence summary of what this piece of evidence actually says.",
          sources: ["src:example-2024"],
        },
      ],
    },
  ],

  sources: {
    "src:example-2024": {
      kind: "paper",
      title: "A representative paper title",
      authors: "Lastname et al.",
      year: 2024,
      published: "Journal of Example Studies",
      url: "https://example.org/paper",
    },
  },
};

export type BulkUploadTemplate = typeof BULK_UPLOAD_TEMPLATE;
