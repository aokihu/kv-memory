/**
 * SQLite schema and connection manager for memory storage.
 *
 * This module only handles database bootstrap and shared connection lifecycle.
 * Debug entry point: start from `initDatabase()` when tables/indexes are missing.
 */

import { Database } from "bun:sqlite";

const DEFAULT_DATABASE_FILE = "kv.db";

let singletonDatabase: Database | null = null;
let singletonDatabaseFile: string | null = null;

/**
 * SQL bootstrap script for all required tables and indexes.
 *
 * Debug hint: if any query path is slow, verify matching index exists in
 * `sqlite_master` with this script's index names.
 */
const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS memories (
  key TEXT NOT NULL,
  namespace TEXT NOT NULL,
  domain TEXT NOT NULL,
  summary TEXT NOT NULL,
  text TEXT NOT NULL,
  type TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]',
  meta TEXT NOT NULL,
  links TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, key)
);

CREATE TABLE IF NOT EXISTS memory_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace TEXT NOT NULL,
  from_key TEXT NOT NULL,
  to_key TEXT NOT NULL,
  link_type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0.5 CHECK (weight >= 0 AND weight <= 1),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (namespace, from_key)
    REFERENCES memories(namespace, key)
    ON DELETE CASCADE,
  FOREIGN KEY (namespace, to_key)
    REFERENCES memories(namespace, key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace);
CREATE INDEX IF NOT EXISTS idx_memories_domain ON memories(domain);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);

CREATE INDEX IF NOT EXISTS idx_memory_links_from_key ON memory_links(from_key);
CREATE INDEX IF NOT EXISTS idx_memory_links_to_key ON memory_links(to_key);
CREATE INDEX IF NOT EXISTS idx_memory_links_link_type ON memory_links(link_type);
`;

/**
 * Get process-wide SQLite connection singleton.
 *
 * Trigger condition: when first called, it creates a new connection.
 * Debug hint: path mismatch error means two callers requested different DB files.
 */
export function getDatabase(databaseFile: string = DEFAULT_DATABASE_FILE): Database {
  if (singletonDatabase !== null) {
    if (singletonDatabaseFile !== databaseFile) {
      throw new Error(
        `Database singleton already initialized with '${singletonDatabaseFile}', cannot switch to '${databaseFile}'`,
      );
    }

    return singletonDatabase;
  }

  singletonDatabase = new Database(databaseFile);
  singletonDatabaseFile = databaseFile;
  return singletonDatabase;
}

/**
 * Initialize database schema on the given or singleton connection.
 *
 * Debug entry point: if startup fails, inspect SQL error raised from `exec`.
 */
export function initDatabase(database: Database = getDatabase()): Database {
  database.exec(SCHEMA_SQL);
  return database;
}

/**
 * Close and reset singleton connection.
 *
 * Trigger condition: used by tests or controlled shutdown to release file lock.
 */
export function closeDatabase(): void {
  if (singletonDatabase === null) {
    return;
  }

  singletonDatabase.close();
  singletonDatabase = null;
  singletonDatabaseFile = null;
}
