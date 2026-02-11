/**
 * DB module exports.
 */

export { getDatabase, initDatabase, closeDatabase } from "./schema";
export { getDatabaseConfig, type DatabaseConfig } from "./config";
export {
  memoryRowToMemory,
  memoryToWritableColumns,
  linksToRelationRows,
  relationRowToMemoryLink,
  mergeMemoryPatch,
  withRenamedMetaId,
  type MemoryRow,
  type MemoryLinkRow,
  type MemoryLinkRelationReadRow,
} from "./query";
export { runInTransaction } from "./transaction";
export { backupDatabaseFile, type BackupResult } from "./backup";
export {
  parseNamespacedKey,
  parseKeyvRowToMemoryRecord,
  readKeyvRows,
  convertKeyvRows,
  buildWritableMigrationData,
  validateMigratedRecords,
  type KeyvRow,
  type MigratedMemoryRecord,
  type MigrationWarning,
} from "./migration-utils";
export { migrateKeyvToSQLite, type MigrationOptions, type MigrationReport } from "./migrate";
