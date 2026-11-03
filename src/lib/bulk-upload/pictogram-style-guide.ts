/**
 * The pictogram style guide, served from /api/admin/bulk/pictogram-style
 * as a downloadable markdown document. Hand this to an AI alongside a list
 * of item names; it should produce `pictogram` strings that render natively
 * in the Made Of style.
 *
 * The guide is intentionally terse and includes concrete examples pulled
 * from the existing set, because AIs follow worked examples far better
 * than prose rules.
 */

export const PICTOGRAM_STYLE_GUIDE = `# Made Of — pictogram style guide

Pictograms are 32×32 SVG inner-markup strings. They render inside a tier-coloured tile with a dark ink border. Keep every pictogram inside this one consistent style — items should look like they belong to the same set.

## Hard rules

1. **ViewBox is 32×32.** Draw coordinates in that space. Do not include an outer \`<svg>\` tag — only the inner elements.
2. **One line.** The stored string is a single line of SVG. No newlines inside.
3. **No colours.** Styling comes from four CSS classes:
    - \`class="b"\` — body: white fill, dark stroke. Use for the main silhouette.
    - \`class="l"\` — line: no fill, dark stroke. Use for details, horizons, outlines inside a body.
    - \`class="k"\` — ink: solid dark fill. Use for small accents, dots, chunky shapes.
    - \`class="w"\` — white line: no fill, white stroke on top of a \`.k\` fill. Use for inner detail inside a solid ink shape.
4. **Allowed elements only:** \`path\`, \`circle\`, \`ellipse\`, \`rect\`, \`line\`, \`polyline\`, \`polygon\`, \`g\`.
5. **Allowed attributes only:** \`class\`, \`cx\`, \`cy\`, \`r\`, \`rx\`, \`ry\`, \`x\`, \`y\`, \`x1\`, \`y1\`, \`x2\`, \`y2\`, \`width\`, \`height\`, \`d\`, \`points\`, \`transform\`. No \`fill\`, \`stroke\`, \`style\`, \`id\`, \`xmlns\`, event handlers, URLs, or filters.
6. **Round number coordinates where possible.** The style reads as hand-drawn; sub-pixel precision is unnecessary noise.

## Visual conventions

- **Weight:** strokes are 2.2 units wide (set globally by CSS). Design assuming thick lines — avoid cramming detail into tight spaces.
- **Scale:** fill the 32×32 box with roughly 2 units of margin on each side. Icons that live near the frame feel too tight.
- **Composition:** one dominant silhouette, optional detail or accent. Avoid more than ~6 elements per pictogram.
- **Symbols before pictures.** If the item is a chemical element, do **not** supply a pictogram — the system draws the element symbol tile automatically. Only pictogram non-elements.

## Worked examples

### Simple body with a detail line

An apple-like shape:

\`\`\`
<path class="b" d="M16 10c-5 0-9 3-9 8s4 9 9 9 9-4 9-9-4-8-9-8z"/><path class="l" d="M16 10V5"/>
\`\`\`

The \`b\` path is the apple body (white, inked outline). The \`l\` path is the stem — thin, lined, no fill.

### Body with an ink accent

A tomato:

\`\`\`
<circle class="b" cx="16" cy="18" r="10"/><path class="l" d="M16 8V5"/><path class="k" d="M12 7l4 2 4-2-1 3-3 1-3-1z"/>
\`\`\`

Circle for the fruit, \`l\` for the stem, \`k\` for the solid dark leaves.

### Group with a transform

Wheat (ellipses rotated outward from a stem):

\`\`\`
<path class="l" d="M16 30V6"/><ellipse class="b" cx="12.5" cy="11" rx="2.6" ry="4.2" transform="rotate(-28 12.5 11)"/><ellipse class="b" cx="19.5" cy="11" rx="2.6" ry="4.2" transform="rotate(28 19.5 11)"/>
\`\`\`

### White lines on an ink body

A chunk of ore:

\`\`\`
<path class="k" d="M5 22l4-9 8-4 9 4 2 9-6 5H10z"/><path class="w" d="M11 14l5-2.5M20 13l3 2"/>
\`\`\`

The \`k\` path paints the dark lump; the \`w\` strokes are the lighter cracks on top of it.

## Common mistakes

- Adding \`fill="#fff"\` or \`stroke="#000"\` — don't. Classes handle that.
- Nesting \`<svg>\` or wrapping in \`<g><svg>...\`.
- Using \`xlink:href\`, \`xmlns\`, \`style\`, or inline event handlers.
- Scaling with CSS transforms outside the viewBox — go to 32×32 natively.
- Pictogramming an element — leave it, the symbol tile is better.

## Prompting an AI

If handing this to an AI to generate pictograms for a batch of items, include this file verbatim, then list the item names + a one-sentence hint for each, and ask for a JSON object mapping \`{ "<item name>": "<svg inner-markup>" }\`. Paste the result into the pack's \`items\` array under each item's \`pictogram\` field.
`;
