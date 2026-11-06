/**
 * The bulk-upload pack template.
 *
 * This is served from /api/admin/bulk/template as a worked example of the
 * pack format. Agents are better at copying examples than at reading JSON
 * schemas, so every field appears at least once with a representative value,
 * and the top-level `_readme` block explains the rules in prose.
 *
 * The `_readme` field is ignored by the planner — it exists purely for the
 * author (human or AI) consuming the template.
 */

export const BULK_UPLOAD_TEMPLATE = {
  _readme: {
    purpose:
      "Additive content pack for Made Of. Describes NEW items, recipes, links, evidence and sources to add to the knowledge base. Not a full replace — items you don't list are left alone.",
    rules: [
      "`name` is the lowercase display name (may contain spaces, e.g. 'big bang'). The slug is derived automatically.",
      "To reference an item that already exists in the KB, use its exact `name`. Download the KB snapshot to see what's there.",
      "An item may have multiple recipes. Each recipe lists `f` (made from), `w` (made with / tools), `n` (needs) and `e` (evolved from). Drop a key when its list is empty.",
      "Item-level links use `linksN` (needs) and `linksS` (comes from). `s` is item-level only — never put it in a recipe.",
      "Evidence links reference the links they describe by id of the form `child<type<parent`, e.g. `RNA<f<nucleotides` means 'RNA is made from nucleotides'.",
      "Every source referenced in an evidence entry must either be defined under `sources` in this pack or already exist in the KB by its code.",
      "Do not restate items that already exist. If you need to add a recipe to an existing item, include the item in `items` with just the new recipe — the planner will offer a merge.",
      "Legal `tier` values: F, N, M, C, P, S. Legal `kind` values are listed under _readme.vocab.kinds (fetch /api/admin/kinds for live list).",
      "Legal `confidence` values: established, strong, debated, hypothesis. Legal `stance` values: supports, contradicts.",
      "Set `isCombineExcluded: true` to keep an item out of every Combine theme (safety net for items in the graph that shouldn't appear on the board). Omit for false.",
      "`tags` is a free-form string array of membership markers. Omit when empty.",
      "`pictogram` is an SVG inner-markup string (no outer <svg> tag). 32×32 viewBox, allowlisted elements and classes only. Download /api/admin/bulk/pictogram-style for the authoring rules and worked examples before writing one.",
      "To introduce a new `kind`, add it under top-level `kinds` with its fallback `pictogram`. Items can then reference it from `kind`.",
    ],
    vocab: {
      tiers: ["F", "N", "M", "C", "P", "S"],
      linkTypesRecipe: ["f", "w", "n", "e"],
      linkTypesItem: ["n", "s"],
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
    },
    firstAppearedFormat:
      "Year string. Use '13.8bya' (billions), '400mya' (millions), '12ka' (thousands), '1994' (CE year), '-3500' (BCE). Prefix with '~' for 'about'.",
  },

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
