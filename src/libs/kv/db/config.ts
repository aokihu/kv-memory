/**
 * Database configuration options.
 *
 * This module centralizes runtime DB path and pragma options.
 * Debug entry point: inspect `getDatabaseConfig()` when runtime config differs from expectation.
 */

/**
 * Runtime database configuration.
 */
export type DatabaseConfig = {
  databaseFile: string;
  pragma: {
    busyTimeoutMs: number;
    journalMode: "WAL" | "DELETE" | "TRUNCATE" | "PERSIST" | "MEMORY" | "OFF";
    foreignKeys: boolean;
  };
};

const DEFAULT_CONFIG: DatabaseConfig = {
  databaseFile: process.env.KVDB_SQLITE_FILE ?? "kv.db",
  pragma: {
    busyTimeoutMs: Number(process.env.KVDB_SQLITE_BUSY_TIMEOUT_MS ?? 5000),
    journalMode: (process.env.KVDB_SQLITE_JOURNAL_MODE as DatabaseConfig["pragma"]["journalMode"] | undefined) ?? "WAL",
    foreignKeys: (process.env.KVDB_SQLITE_FOREIGN_KEYS ?? "on").toLowerCase() !== "off",
  },
};

/**
 * Get current DB configuration snapshot.
 */
export function getDatabaseConfig(): DatabaseConfig {
  return {
    databaseFile: DEFAULT_CONFIG.databaseFile,
    pragma: {
      busyTimeoutMs: DEFAULT_CONFIG.pragma.busyTimeoutMs,
      journalMode: DEFAULT_CONFIG.pragma.journalMode,
      foreignKeys: DEFAULT_CONFIG.pragma.foreignKeys,
    },
  };
}
