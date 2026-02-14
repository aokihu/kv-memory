/**
 * DB module exports.
 */

export {
  getDatabase,
  initDatabase,
  closeDatabase,
  optimizeFtsIndex,
  rebuildFtsIndex,
} from "./schema";
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
export {
  runInTransaction,
  runInTransactionWithRetry,
  runBatchInTransaction,
  runBatchInTransactionWithRetry,
  isSqliteBusyError,
  type TransactionRetryOptions,
  type TransactionRetryContext,
} from "./transaction";
export { backupDatabaseFile, type BackupResult } from "./backup";
export {
  runQuickCheck,
  runIntegrityCheck,
  runFts5IntegrityCheck,
  type DatabaseIntegrityCheckMode,
  type DatabaseIntegrityCheckResult,
  type Fts5IntegrityCheckMode,
  type Fts5IntegrityCheckResult,
} from "./integrity";
