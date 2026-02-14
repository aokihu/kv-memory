/**
 * FTS5 repair command implementation.
 *
 * Debug entry: if verification fails, inspect JSON output field `verification.error`.
 */

import {
  closeDatabase,
  getDatabase,
  initDatabase,
  rebuildFtsIndex,
  runIntegrityCheck,
  runQuickCheck,
  type DatabaseIntegrityCheckResult,
} from "../libs/kv/db";
import { runCommandSafely, type CliLogger } from "./common";

type SampleRow = {
  key: string;
  summary: string;
  text: string;
};

export type SearchVerificationResult = {
  ok: boolean;
  keyword: string;
  hits: number;
  inspectedKey: string | null;
  error?: string;
};

export type RepairCommandResult = {
  databaseFile: string;
  startedAt: number;
  finishedAt: number;
  integrityBefore: {
    quick: DatabaseIntegrityCheckResult;
    full: DatabaseIntegrityCheckResult;
  };
  integrityAfter: {
    quick: DatabaseIntegrityCheckResult;
    full: DatabaseIntegrityCheckResult;
  };
  rebuild: {
    ok: boolean;
  };
  verification: SearchVerificationResult;
};

export type RepairCommandOptions = {
  databaseFile?: string;
  keyword?: string;
  logger?: CliLogger;
};

/**
 * Execute integrity checks, rebuild FTS index, then verify search path.
 */
export function runRepairCommand(options: RepairCommandOptions = {}): number {
  const scope = "repair";
  const run = (logger: CliLogger): number => {
    const result = executeRepair(options);
    logger.log("info", "repair completed");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.verification.ok ? 0 : 1;
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

function executeRepair(options: RepairCommandOptions): RepairCommandResult {
  const startedAt = Date.now();
  const databaseFile = options.databaseFile ?? process.env.KVDB_SQLITE_FILE ?? "kv.db";
  const db = initDatabase(getDatabase(databaseFile));

  const integrityBefore = {
    quick: runQuickCheck(db),
    full: runIntegrityCheck(db),
  };

  rebuildFtsIndex(db);

  const integrityAfter = {
    quick: runQuickCheck(db),
    full: runIntegrityCheck(db),
  };

  const verification = verifySearch(db, options.keyword);

  return {
    databaseFile,
    startedAt,
    finishedAt: Date.now(),
    integrityBefore,
    integrityAfter,
    rebuild: { ok: true },
    verification,
  };
}

function verifySearch(db: ReturnType<typeof getDatabase>, keywordOverride?: string): SearchVerificationResult {
  const sample = db.query("SELECT key, summary, text FROM memories ORDER BY created_at DESC LIMIT 1").get() as
    | SampleRow
    | null;

  const keyword = keywordOverride ?? pickKeyword(sample ? `${sample.summary} ${sample.text}` : "memory");

  try {
    const rows = db
      .query("SELECT key FROM memories_fts WHERE memories_fts MATCH ? LIMIT 5")
      .all(`"${keyword.replace(/"/g, '""')}"`) as Array<{ key: string }>;

    return {
      ok: true,
      keyword,
      hits: rows.length,
      inspectedKey: sample?.key ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      keyword,
      hits: 0,
      inspectedKey: sample?.key ?? null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function pickKeyword(value: string): string {
  const token = value.toLowerCase().match(/[a-z0-9_\u4e00-\u9fa5]{2,}/)?.[0];
  return token ?? "memory";
}
