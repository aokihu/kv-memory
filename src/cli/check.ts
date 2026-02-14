/**
 * Startup FTS5 integrity check command implementation.
 *
 * Debug entry: if FULL mode fails, inspect trigger existence and FTS row count parity.
 */

import {
  closeDatabase,
  getDatabase,
  initDatabase,
  runFts5IntegrityCheck,
  type Fts5IntegrityCheckMode,
} from "../libs/kv/db";
import { runCommandSafely, type CliLogger } from "./common";

export type CheckCommandOptions = {
  databaseFile?: string;
  mode?: Fts5IntegrityCheckMode;
  shouldInit?: boolean;
  logger?: CliLogger;
};

/**
 * Execute startup-compatible FTS5 integrity verification.
 */
export function runCheckCommand(options: CheckCommandOptions = {}): number {
  const scope = "check";
  const run = (logger: CliLogger): number => {
    const databaseFile = options.databaseFile ?? process.env.KVDB_SQLITE_FILE ?? "kv.db";
    const mode = options.mode ?? "QUICK";
    const shouldInit = options.shouldInit ?? false;

    const db = getDatabase(databaseFile);
    if (shouldInit) {
      initDatabase(db);
    }

    const result = runFts5IntegrityCheck(db, mode);
    logger.log("info", "check completed");
    process.stdout.write(`${JSON.stringify({ databaseFile, shouldInit, ...result }, null, 2)}\n`);
    return result.ok ? 0 : 1;
  };

  try {
    if (options.logger) {
      return run(options.logger);
    }
    return runCommandSafely(scope, run);
  } finally {
    closeDatabase();
  }
}

export function normalizeCheckMode(value: string | undefined): Fts5IntegrityCheckMode {
  const normalized = (value ?? "QUICK").trim().toUpperCase();
  if (normalized === "FULL") {
    return "FULL";
  }
  return "QUICK";
}
