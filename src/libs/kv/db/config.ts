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
  /**
   * Toggle search-related features.
   *
   * Environment: KVDB_SEARCH_ENABLED
   * Default: true (backward compatible)
   */
  searchEnabled: boolean;
  pragma: {
    busyTimeoutMs: number;
    journalMode: "WAL" | "DELETE" | "TRUNCATE" | "PERSIST" | "MEMORY" | "OFF";
    foreignKeys: boolean;
  };
};

/**
 * Parse boolean-like environment variable with a fallback default.
 *
 * Debug tip: if search config behaves unexpectedly, check raw env value
 * from KVDB_SEARCH_ENABLED and whether it matches false-like tokens.
 */
function parseEnvBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no") {
    return false;
  }

  if (normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes") {
    return true;
  }

  return fallback;
}

const DEFAULT_CONFIG: DatabaseConfig = {
  databaseFile: process.env.KVDB_SQLITE_FILE ?? "kv.db",
  searchEnabled: parseEnvBoolean(process.env.KVDB_SEARCH_ENABLED, true),
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
    searchEnabled: DEFAULT_CONFIG.searchEnabled,
    pragma: {
      busyTimeoutMs: DEFAULT_CONFIG.pragma.busyTimeoutMs,
      journalMode: DEFAULT_CONFIG.pragma.journalMode,
      foreignKeys: DEFAULT_CONFIG.pragma.foreignKeys,
    },
  };
}
