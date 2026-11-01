/**
 * Generate a static HTML audit page of every pictogram in the knowledge base,
 * grouped by kind, so broken/off-brand ones can be eyeballed at a glance.
 *
 * Run: npx tsx scripts/picto-audit.ts > /tmp/picto-audit.html && open /tmp/picto-audit.html
 */

import { PICTO, KIND_PICTO } from "../src/pictograms/data";
import { ITEMS } from "../src/data/items.data";
import type { ItemKind } from "../src/db/schema";

const KIND_ORDER: ItemKind[] = [
  "cosmic",
  "element",
  "mineral",
  "substance",
  "living",
  "food",
  "part",
  "object",
  "tool",
  "place",
  "information",
  "energy",
];

const TIER_FILL: Record<string, string> = {
  F: "#e8d9ff",
  N: "#d7f0d9",
  M: "#ffe6c7",
  C: "#cfe6ff",
  P: "#ffd7d7",
  S: "#e4e4e4",
};

const TIER_INK: Record<string, string> = {
  F: "#5a2fb8",
  N: "#2a7a35",
  M: "#8a4a00",
  C: "#1f5fa8",
  P: "#a62b2b",
  S: "#444",
};

const picto = PICTO as Record<string, string>;
const kindPicto = KIND_PICTO as Record<string, string>;

const byKind = new Map<ItemKind, typeof ITEMS>();
for (const item of ITEMS) {
  const arr = byKind.get(item.kind) ?? [];
  arr.push(item);
  byKind.set(item.kind, arr);
}
for (const arr of byKind.values()) {
  arr.sort((a, b) => a.name.localeCompare(b.name));
}

function tileFor(item: (typeof ITEMS)[number]): string {
  const fill = TIER_FILL[item.tier] ?? "#fff";
  const ink = TIER_INK[item.tier] ?? "#111417";
  const isFallback = !picto[item.name] && !item.symbol;
  const svg = item.symbol
    ? ""
    : picto[item.name] ?? kindPicto[item.kind] ?? "";
  const body = item.symbol
    ? `<div class="sym" style="--ink:${ink};background:${fill}">${item.symbol}</div>`
    : `<div class="ic" style="--ink:${ink};background:${fill}"><svg viewBox="0 0 32 32" aria-hidden="true">${svg}</svg></div>`;
  return `
    <div class="cell ${isFallback ? "fallback" : ""}">
      ${body}
      <div class="label">${item.name}</div>
      ${isFallback ? '<div class="tag">fallback</div>' : ""}
    </div>`;
}

const sections = KIND_ORDER.filter((k) => byKind.has(k))
  .map((kind) => {
    const items = byKind.get(kind)!;
    const specifics = items.filter((i) => picto[i.name] || i.symbol).length;
    const fallbacks = items.length - specifics;
    return `
      <section>
        <h2>${kind} <small>(${items.length} total — ${specifics} specific, ${fallbacks} fallback)</small></h2>
        <div class="grid">${items.map(tileFor).join("")}</div>
      </section>`;
  })
  .join("\n");

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Pictogram audit — Made Of</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; margin: 24px; background:#fafafa; color:#111417 }
  h1 { margin: 0 0 8px }
  h2 { margin: 24px 0 10px; text-transform:capitalize }
  small { color:#888; font-weight:400; font-size:14px }
  .legend { color:#555; font-size:13px; margin-bottom:16px }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:12px }
  .cell { display:flex; flex-direction:column; align-items:center; gap:6px; padding:10px 6px; border:1px solid #e4e4e4; border-radius:6px; background:#fff }
  .cell.fallback { background:#f6f6f6; border-style:dashed }
  .ic, .sym { width:72px; height:72px; border-radius:6px; border:2px solid var(--ink); display:grid; place-items:center; color:var(--ink); box-sizing:border-box }
  .ic svg { width:84%; height:84%; display:block; overflow:visible }
  .ic svg .b { fill:#fff; stroke:var(--ink); stroke-width:2.2; stroke-linejoin:round; stroke-linecap:round }
  .ic svg .l { fill:none; stroke:var(--ink); stroke-width:2.2; stroke-linejoin:round; stroke-linecap:round }
  .ic svg .k { fill:var(--ink) }
  .ic svg .w { fill:none; stroke:#fff; stroke-width:2; stroke-linecap:round }
  .sym { font-weight:700; font-size:28px; font-family:ui-monospace, Menlo, monospace }
  .label { font-size:11px; text-align:center; line-height:1.2; word-break:break-word }
  .tag { font-size:9px; color:#888 }
</style>
</head>
<body>
  <h1>Pictogram audit</h1>
  <div class="legend">
    ${ITEMS.length} items total. Dashed/grey tiles use the kind's fallback picto.
    Specific pictos: ${Object.keys(picto).length}.
  </div>
  ${sections}
</body>
</html>`;

process.stdout.write(html);
