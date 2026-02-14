/**
 * Backward-compatible wrapper for check CLI command.
 */

import { normalizeCheckMode, runCheckCommand } from "../src/cli/check";

const databaseFile = Bun.argv[2] ?? process.env.KVDB_SQLITE_FILE;
const mode = normalizeCheckMode(Bun.argv[3]);
const shouldInit = Bun.argv.includes("--init");

process.exitCode = runCheckCommand({
  databaseFile,
  mode,
  shouldInit,
});
