/**
 * One-shot generator: emit the SQL backfill statements for migration 0012.
 *
 * Rendered inline into drizzle/0012_pictograms.sql so the migration is
 * self-contained. The output is committed; this script is only re-run if
 * the source pictograms change before deploy.
 */

// A direct ESM-style import works under tsx without extra registers.
// @ts-expect-error — importing a .ts file directly is fine under tsx.
import { KIND_PICTO, PICTO } from "../src/pictograms/data";

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

const lines: string[] = [];
lines.push("-- Backfill pictograms from src/pictograms/data.ts.");
lines.push("-- Kinds first (fallback), then specific item pictograms.");
lines.push("");

for (const [code, svg] of Object.entries(KIND_PICTO as Record<string, string>)) {
  lines.push(
    `UPDATE "kinds" SET "pictogram" = '${esc(svg)}' WHERE "code" = '${esc(code)}';`,
  );
}
lines.push("");

for (const [name, svg] of Object.entries(PICTO as Record<string, string>)) {
  lines.push(
    `UPDATE "items" SET "pictogram" = '${esc(svg)}' WHERE "name" = '${esc(name)}';`,
  );
}

console.log(lines.join("\n"));
