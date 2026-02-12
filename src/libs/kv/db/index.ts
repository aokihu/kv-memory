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
export { runInTransaction } from "./transaction";
export { backupDatabaseFile, type BackupResult } from "./backup";
