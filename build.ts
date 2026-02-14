/**
 * Build script for compiling CLI into a standalone executable.
 *
 * Debug entry: if binary is missing, inspect `result.logs` from Bun.build output.
 */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const DIST_DIR = resolve(process.cwd(), "dist");
const OUTFILE = resolve(DIST_DIR, "kvdb-mem");

await mkdir(DIST_DIR, { recursive: true });

const result = await Bun.build({
  entrypoints: ["./src/cli/index.ts"],
  target: "bun",
  format: "esm",
  sourcemap: "none",
  minify: true,
  compile: {
    outfile: OUTFILE,
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.info("[build] executable generated");
for (const output of result.outputs) {
  console.info(`[build] ${output.path}`);
}
