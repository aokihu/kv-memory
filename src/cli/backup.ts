/**
 * Backup command implementation.
 *
 * Debug entry: if backup output is missing, check resolved `databaseFile` and `backupDir`.
 */

import { resolve } from "node:path";
import { backupDatabaseFile } from "../libs/kv/db";
import { runCommandSafely, type CliLogger } from "./common";

export type BackupCommandOptions = {
  databaseFile?: string;
  backupDir?: string;
  cwd?: string;
  logger?: CliLogger;
};

/**
 * Execute database backup and print JSON result.
 */
export function runBackupCommand(options: BackupCommandOptions = {}): number {
  const scope = "backup";
  const run = (logger: CliLogger): number => {
    const cwd = options.cwd ?? process.cwd();
    const databaseFile = options.databaseFile ?? process.env.KVDB_SQLITE_FILE ?? "kv.db";
    const backupDir = options.backupDir ?? process.env.KVDB_BACKUP_DIR ?? "backups";

    const result = backupDatabaseFile(resolve(cwd, databaseFile), resolve(cwd, backupDir));

    logger.log("info", "backup completed");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  };

  if (options.logger) {
    return run(options.logger);
  }

  return runCommandSafely(scope, run);
}
