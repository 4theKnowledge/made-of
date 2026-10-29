// Bundle the predeploy scripts (migrate, seed, seed-if-empty) into a tiny
// dist folder of plain Node .js files. Runtime image can then invoke them
// with `node dist-scripts/<name>.js` — no tsx, no drizzle-kit, no src/*.
//
// Postgres is kept as an external require so the standalone node_modules
// provides it; esbuild bundles our own TS plus drizzle-orm.

import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist-scripts", { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  logLevel: "info",
  // These stay external — require() picks them up from node_modules at runtime.
  external: ["postgres"],
};

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/db/migrate.ts"],
    outfile: "dist-scripts/migrate.js",
  }),
  build({
    ...common,
    entryPoints: ["src/db/seed.ts"],
    outfile: "dist-scripts/seed.js",
  }),
  build({
    ...common,
    entryPoints: ["scripts/seed-if-empty.ts"],
    outfile: "dist-scripts/seed-if-empty.js",
    // seed-if-empty does a dynamic import("../src/db/seed") — rewrite that
    // to point at the sibling bundled file at runtime, and mark it external
    // so esbuild doesn't try to resolve it at build time.
    external: [...common.external, "./seed.js"],
    plugins: [
      {
        name: "rewrite-dynamic-seed-import",
        setup(b) {
          b.onLoad({ filter: /scripts\/seed-if-empty\.ts$/ }, async (args) => {
            const fs = await import("node:fs/promises");
            let source = await fs.readFile(args.path, "utf8");
            source = source.replace(
              /await import\(["']\.\.\/src\/db\/seed["']\)/g,
              'await import("./seed.js")',
            );
            return { contents: source, loader: "ts" };
          });
        },
      },
    ],
  }),
]);
