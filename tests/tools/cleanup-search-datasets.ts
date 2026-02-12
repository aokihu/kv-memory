/**
 * Search test dataset cleanup tool.
 *
 * What it does:
 * - Removes imported search test data by key prefix.
 *
 * Why this exists:
 * - Keeps test DB clean between repeated dataset import runs.
 *
 * Debug hint:
 * - If rows remain after cleanup, check the prefix used during import.
 */

import { getDatabase, initDatabase } from "../../src/libs/kv/db";

const DEFAULT_PREFIX = "test:search:";

/**
 * Parse cleanup prefix from CLI args.
 */
function parsePrefix(argv: string[]): string {
  const prefixFlag = argv.find((arg) => arg.startsWith("--prefix="));
  if (!prefixFlag) {
    return DEFAULT_PREFIX;
  }

  const value = prefixFlag.slice("--prefix=".length).trim();
  if (value.length === 0) {
    return DEFAULT_PREFIX;
  }

  return value;
}

/**
 * Execute cleanup SQL for memories and links.
 */
function cleanupByPrefix(prefix: string): void {
  const db = initDatabase(getDatabase());

  db.query("DELETE FROM memory_links WHERE from_key LIKE ? OR to_key LIKE ?").run(`${prefix}%`, `${prefix}%`);
  db.query("DELETE FROM memories WHERE key LIKE ?").run(`${prefix}%`);
}

function main(): void {
  const prefix = parsePrefix(process.argv.slice(2));
  cleanupByPrefix(prefix);
  console.log(`[done] cleaned test datasets with prefix: ${prefix}`);
}

main();
