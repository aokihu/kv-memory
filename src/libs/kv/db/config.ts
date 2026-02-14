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
    synchronous: "OFF" | "NORMAL" | "FULL" | "EXTRA";
    foreignKeys: boolean;
  };
  maintenance: {
    walCheckpointIntervalMs: number;
    startupIntegrityCheck: "OFF" | "QUICK" | "FULL";
    startupFts5IntegrityCheck: "OFF" | "QUICK" | "FULL";
  };
};

const SQLITE_JOURNAL_MODE_VALUES = ["WAL", "DELETE", "TRUNCATE", "PERSIST", "MEMORY", "OFF"] as const;
const SQLITE_SYNCHRONOUS_VALUES = ["OFF", "NORMAL", "FULL", "EXTRA"] as const;
const STARTUP_INTEGRITY_CHECK_VALUES = ["OFF", "QUICK", "FULL"] as const;
const STARTUP_FTS5_INTEGRITY_CHECK_VALUES = ["OFF", "QUICK", "FULL"] as const;

function parsePragmaEnum<TValue extends string>(
  rawValue: string | undefined,
  allowedValues: readonly TValue[],
  fallback: TValue,
): TValue {
  if (rawValue === undefined) {
    return fallback;
  }

  const normalized = rawValue.trim().toUpperCase() as TValue;
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.floor(parsed);
  return normalized >= 0 ? normalized : fallback;
}

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
    journalMode: parsePragmaEnum(process.env.KVDB_SQLITE_JOURNAL_MODE, SQLITE_JOURNAL_MODE_VALUES, "WAL"),
    synchronous: parsePragmaEnum(process.env.KVDB_SQLITE_SYNCHRONOUS, SQLITE_SYNCHRONOUS_VALUES, "EXTRA"),
    foreignKeys: (process.env.KVDB_SQLITE_FOREIGN_KEYS ?? "on").toLowerCase() !== "off",
  },
  maintenance: {
    walCheckpointIntervalMs: parseNonNegativeInteger(process.env.KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS, 60000),
    startupIntegrityCheck: parsePragmaEnum(
      process.env.KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP,
      STARTUP_INTEGRITY_CHECK_VALUES,
      "OFF",
    ),
    startupFts5IntegrityCheck: parsePragmaEnum(
      process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP,
      STARTUP_FTS5_INTEGRITY_CHECK_VALUES,
      "OFF",
    ),
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
      synchronous: DEFAULT_CONFIG.pragma.synchronous,
      foreignKeys: DEFAULT_CONFIG.pragma.foreignKeys,
    },
    maintenance: {
      walCheckpointIntervalMs: DEFAULT_CONFIG.maintenance.walCheckpointIntervalMs,
      startupIntegrityCheck: DEFAULT_CONFIG.maintenance.startupIntegrityCheck,
      startupFts5IntegrityCheck: DEFAULT_CONFIG.maintenance.startupFts5IntegrityCheck,
    },
  };
}
