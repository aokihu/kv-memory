/**
 * Unified CLI entry for KVDB maintenance commands.
 *
 * Debug entry: run `kvdb-mem --help` and confirm command table when dispatch looks incorrect.
 */

import { runBackupCommand } from "./backup";
import { runRepairCommand } from "./repair";
import { normalizeCheckMode, runCheckCommand } from "./check";
import {
  getBooleanFlag,
  getCliArgv,
  getStringFlag,
  parseCliInput,
  runCommandSafely,
  type CliLogger,
} from "./common";

const HELP_TEXT = `kvdb-mem CLI

Usage:
  kvdb-mem <command> [options]

Commands:
  backup   Backup sqlite database and sidecar files
  repair   Rebuild FTS5 index with integrity checks
  check    Run startup-like FTS5 integrity check
  help     Show this help text

Global options:
  --help

backup options:
  --db <path>           SQLite file path (default: KVDB_SQLITE_FILE or kv.db)
  --backup-dir <path>   Backup output directory (default: KVDB_BACKUP_DIR or backups)

repair options:
  --db <path>           SQLite file path (default: KVDB_SQLITE_FILE or kv.db)
  --keyword <value>     Optional keyword for post-rebuild FTS verification

check options:
  --db <path>           SQLite file path (default: KVDB_SQLITE_FILE or kv.db)
  --mode <QUICK|FULL>   Integrity check depth (default: QUICK)
  --init                Initialize schema before check (for fresh DB)
`;

/**
 * CLI process dispatcher.
 */
export function runCli(argv = getCliArgv()): number {
  const input = parseCliInput(argv);

  if (
    input.command === null ||
    input.command === "help" ||
    input.command === "--help" ||
    getBooleanFlag(input.flags, "help")
  ) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  const command = input.command;
  return runCommandSafely("main", (logger) => dispatchCommand(command, input, logger));
}

function dispatchCommand(
  command: string,
  input: ReturnType<typeof parseCliInput>,
  logger: CliLogger,
): number {
  if (command === "backup") {
    return runBackupCommand({
      databaseFile: getStringFlag(input.flags, "db"),
      backupDir: getStringFlag(input.flags, "backup-dir"),
      logger,
    });
  }

  if (command === "repair") {
    return runRepairCommand({
      databaseFile: getStringFlag(input.flags, "db"),
      keyword: getStringFlag(input.flags, "keyword"),
      logger,
    });
  }

  if (command === "check") {
    const modeFlag = getStringFlag(input.flags, "mode") ?? input.args[0];
    return runCheckCommand({
      databaseFile: getStringFlag(input.flags, "db"),
      mode: normalizeCheckMode(modeFlag),
      shouldInit: getBooleanFlag(input.flags, "init"),
      logger,
    });
  }

  logger.log("error", `unknown command: ${command}`);
  process.stdout.write(`${HELP_TEXT}\n`);
  return 1;
}

if (import.meta.main) {
  process.exitCode = runCli();
}
