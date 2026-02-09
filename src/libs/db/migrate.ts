/**
 * Keyv SQLite -> new schema migration entry.
 *
 * This script migrates legacy `keyv` table data into `memories` and `memory_links`.
 * Debug entry point: start from `migrateKeyvToSQLite()` for full workflow trace.
 */

import { Database } from "bun:sqlite";
import { backupDatabaseFile, type BackupResult } from "./backup";
import {
  buildWritableMigrationData,
  convertKeyvRows,
  readKeyvRows,
  validateMigratedRecords,
  type MigratedMemoryRecord,
  type MigrationWarning,
} from "./migration-utils";
import { initDatabase } from "./schema";
import { runInTransaction } from "./transaction";

/**
 * Migration function options.
 */
export type MigrationOptions = {
  sourcePath: string;
  targetPath?: string;
  backupDir?: string;
  dryRun?: boolean;
};

/**
 * Migration execution report.
 */
export type MigrationReport = {
  sourcePath: string;
  targetPath: string;
  backup: BackupResult;
  sourceRows: number;
  migratedRecords: number;
  skippedRows: number;
  insertedLinkRows: number;
  warnings: MigrationWarning[];
  validation: {
    total: number;
    matched: number;
    mismatches: string[];
  };
  dryRun: boolean;
};

/**
 * Run Keyv-to-SQLite migration with backup, transform, insert, and validation.
 *
 * Trigger condition: operator provides source DB path.
 * Recovery guide: if this fails, restore from backup path in returned/printed report.
 */
export function migrateKeyvToSQLite(options: MigrationOptions): MigrationReport {
  const sourcePath = options.sourcePath;
  const targetPath = options.targetPath ?? sourcePath;
  const dryRun = options.dryRun ?? false;

  const backup = backupDatabaseFile(sourcePath, options.backupDir);

  const sourceDatabase = new Database(sourcePath, { readonly: true, create: false });
  try {
    const sourceRows = readKeyvRows(sourceDatabase);
    const conversion = convertKeyvRows(sourceRows);

    if (dryRun) {
      return {
        sourcePath,
        targetPath,
        backup,
        sourceRows: sourceRows.length,
        migratedRecords: conversion.records.length,
        skippedRows: conversion.warnings.length,
        insertedLinkRows: countPotentialLinkRows(conversion.records),
        warnings: conversion.warnings,
        validation: {
          total: conversion.records.length,
          matched: 0,
          mismatches: [],
        },
        dryRun,
      };
    }

    const targetDatabase = initDatabase(new Database(targetPath));
    try {
      const insertedLinkRows = upsertMigratedData(targetDatabase, conversion.records);
      const validation = validateMigratedRecords(targetDatabase, conversion.records);

      return {
        sourcePath,
        targetPath,
        backup,
        sourceRows: sourceRows.length,
        migratedRecords: conversion.records.length,
        skippedRows: conversion.warnings.length,
        insertedLinkRows,
        warnings: conversion.warnings,
        validation,
        dryRun,
      };
    } finally {
      targetDatabase.close();
    }
  } finally {
    sourceDatabase.close();
  }
}

/**
 * Upsert converted records and synchronize relation rows.
 *
 * Idempotency rule: same source records produce same target state on repeated runs.
 */
function upsertMigratedData(targetDatabase: Database, records: MigratedMemoryRecord[]): number {
  if (records.length === 0) {
    return 0;
  }

  let insertedLinkRows = 0;

  runInTransaction(targetDatabase, () => {
    const upsertMemory = targetDatabase.query(
      `INSERT INTO memories (key, namespace, domain, summary, text, type, keywords, meta, links, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(namespace, key) DO UPDATE SET
         domain = excluded.domain,
         summary = excluded.summary,
         text = excluded.text,
         type = excluded.type,
         keywords = excluded.keywords,
         meta = excluded.meta,
         links = excluded.links,
         created_at = excluded.created_at`,
    );

    const deleteLinkBySource = targetDatabase.query(
      `DELETE FROM memory_links WHERE namespace = ? AND from_key = ?`,
    );

    const insertLinkIfTargetExists = targetDatabase.query(
      `INSERT INTO memory_links (namespace, from_key, to_key, link_type, weight, created_at)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM memories m WHERE m.namespace = ? AND m.key = ?
       )`,
    );

    for (const record of records) {
      const writable = buildWritableMigrationData(record);
      upsertMemory.run(
        writable.key,
        writable.namespace,
        writable.memoryColumns.domain,
        writable.memoryColumns.summary,
        writable.memoryColumns.text,
        writable.memoryColumns.type,
        writable.memoryColumns.keywords,
        writable.memoryColumns.meta,
        writable.memoryColumns.links,
        writable.memoryColumns.created_at,
      );
    }

    for (const record of records) {
      const writable = buildWritableMigrationData(record);
      deleteLinkBySource.run(writable.namespace, writable.key);

      for (const linkRow of writable.linkRows) {
        const result = insertLinkIfTargetExists.run(
          linkRow.namespace,
          linkRow.from_key,
          linkRow.to_key,
          linkRow.link_type,
          linkRow.weight,
          linkRow.created_at,
          linkRow.namespace,
          linkRow.to_key,
        );

        insertedLinkRows += Number(result.changes ?? 0);
      }
    }
  });

  return insertedLinkRows;
}

/**
 * Estimate relation rows that can be generated from source records.
 */
function countPotentialLinkRows(records: MigratedMemoryRecord[]): number {
  let count = 0;
  for (const record of records) {
    for (const link of record.memory.links) {
      if (link.key) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Parse command line options.
 */
function parseCliArgs(argv: string[]): MigrationOptions {
  const options: MigrationOptions = { sourcePath: "" };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--source") {
      options.sourcePath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--target") {
      options.targetPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--backup-dir") {
      options.backupDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--help") {
      printUsageAndExit(0);
    }
  }

  if (!options.sourcePath) {
    printUsageAndExit(1);
  }

  return options;
}

/**
 * Print command usage and exit.
 */
function printUsageAndExit(code: number): never {
  console.log("Usage: bun run src/libs/db/migrate.ts --source <path> [--target <path>] [--backup-dir <dir>] [--dry-run]");
  process.exit(code);
}

if (import.meta.main) {
  try {
    const options = parseCliArgs(Bun.argv.slice(2));
    const report = migrateKeyvToSQLite(options);

    console.log(JSON.stringify(report, null, 2));

    if (report.validation.mismatches.length > 0) {
      console.error("Migration completed with mismatches. Restore from backup if needed:", report.backup.backupPath);
      process.exit(2);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Migration failed:", message);
    console.error("Recovery guide: verify backup files and rerun with --dry-run first.");
    process.exit(1);
  }
}
