/**
 * One-shot: write initial `tags` fields into src/data/items.data.ts based on
 * the hard-coded lists in src/combine/filters.ts. After this runs the lists
 * can be deleted — tags on items are the source of truth.
 *
 * Run with:  npx tsx scripts/backfill-tags.ts
 *
 * Idempotent: items that already have a `tags:` line are left alone.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  COMBINE_EXCLUDE,
  EVERYDAY_BASE,
  EVERYDAY_EXTRA,
} from "../src/combine/filters";
import type { Tag } from "../src/data/types";

const ITEMS_FILE = resolve(process.cwd(), "src/data/items.data.ts");

/** The fab-chain subset of COMBINE_EXCLUDE (everything except `big bang`). */
function isFabChain(name: string): boolean {
  return COMBINE_EXCLUDE.has(name) && name !== "big bang";
}

function tagsFor(name: string): Tag[] {
  const tags: Tag[] = [];
  if ([...EVERYDAY_BASE, ...EVERYDAY_EXTRA].includes(name)) {
    tags.push("combine-everyday");
  }
  if (COMBINE_EXCLUDE.has(name)) tags.push("combine-exclude");
  if (isFabChain(name)) tags.push("fab-chain");
  return tags;
}

/** Format a tag list as a one-line TS literal. */
function fmtTags(tags: Tag[]): string {
  return `    tags: [${tags.map((t) => `"${t}"`).join(", ")}],`;
}

async function main() {
  const src = await readFile(ITEMS_FILE, "utf8");

  // Walk through each item block. An item block starts at `  {` after `const
  // ITEMS: DataItem[] = [` and ends at the next `  },` at the same indent.
  // The simpler approach: match each `    name: "X",` and inject a `tags:`
  // line right before the closing `  },` of its block.
  //
  // We do a one-pass scan rather than a regex because the item blocks are
  // multi-line and nested with recipe literals.

  const lines = src.split("\n");
  const out: string[] = [];

  let inItemBlock = false;
  let currentName: string | null = null;
  let itemHasTags = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inItemBlock) {
      out.push(line);
      // Start of an item block: `  {` at column 2.
      if (line === "  {") {
        inItemBlock = true;
        currentName = null;
        itemHasTags = false;
        braceDepth = 1;
      }
      continue;
    }

    // Count braces so we know when we've left the item (recipes are nested
    // inside). An item block ends when a `  },` closes depth back to 0.
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
    }

    // Name line: `    name: "foo",`
    const nameMatch = line.match(/^    name: "(.+)",\s*$/);
    if (nameMatch) currentName = nameMatch[1];

    // Tags line: `    tags: [...]`
    if (/^    tags:\s*\[/.test(line)) itemHasTags = true;

    // End of item block: `  },` at column 2 and depth returned to 0.
    if (line === "  }," && braceDepth === 0) {
      if (!itemHasTags && currentName) {
        const tags = tagsFor(currentName);
        if (tags.length > 0) {
          // Insert `    tags: [...]` just before the closing `  },`.
          out.push(fmtTags(tags));
        }
      }
      out.push(line);
      inItemBlock = false;
      continue;
    }

    out.push(line);
  }

  const next = out.join("\n");
  await writeFile(ITEMS_FILE, next, "utf8");

  // Summary.
  const everyday = [...EVERYDAY_BASE, ...EVERYDAY_EXTRA].length;
  const excludes = COMBINE_EXCLUDE.size;
  console.log(
    `backfill-tags: wrote ${ITEMS_FILE}\n` +
      `  combine-everyday candidates: ${everyday}\n` +
      `  combine-exclude candidates:  ${excludes}\n` +
      `  fab-chain candidates:        ${excludes - 1}\n` +
      `(items not present in the knowledge base are skipped silently)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
