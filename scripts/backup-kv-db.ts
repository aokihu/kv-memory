/**
 * Backward-compatible wrapper for backup CLI command.
 */

import { runCli } from "../src/cli/index";

process.exitCode = runCli(["kvdb-mem", "backup", ...Bun.argv.slice(2)]);
