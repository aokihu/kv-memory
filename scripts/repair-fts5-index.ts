/**
 * Backward-compatible wrapper for repair CLI command.
 */

import { runCli } from "../src/cli/index";

process.exitCode = runCli(["kvdb-mem", "repair", ...Bun.argv.slice(2)]);
