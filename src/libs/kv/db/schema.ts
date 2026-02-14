import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { getDatabaseConfig } from "./config";
import { runFts5IntegrityCheck, runIntegrityCheck, runQuickCheck } from "./integrity";
import {
  addScoreColumnToMemories,
  createScoreIndexOnMemories,
  initializeExistingMemoryScores,
} from "./migration";

let databaseSingleton: Database | null = null;
let databaseSingletonPath: string | null = null;
let walCheckpointTimer: ReturnType<typeof setTimeout> | null = null;

type WalCheckpointRow = {
  busy?: number;
  log?: number;
  checkpointed?: number;
};

type WalResidueDetection = {
  walFileExists: boolean;
  shmFileExists: boolean;
};

/**
 * Get the shared database instance.
 *
 * Debug tip: if this throws path-switch error, inspect who initialized first.
 */
export function getDatabase(databaseFile?: string): Database {
  const config = getDatabaseConfig();
  const targetPath = databaseFile ?? config.databaseFile;

  if (databaseSingleton !== null) {
    if (databaseSingletonPath !== targetPath) {
      throw new Error(
        `Database singleton already initialized with '${databaseSingletonPath}', cannot switch to '${targetPath}'`,
      );
    }

    return databaseSingleton;
  }

  const db = new Database(targetPath);
  db.exec(`PRAGMA journal_mode = ${config.pragma.journalMode}`);
  db.exec(`PRAGMA synchronous = ${config.pragma.synchronous}`);
  db.exec(`PRAGMA busy_timeout = ${config.pragma.busyTimeoutMs}`);
  db.exec("PRAGMA cache_size = -64000");
  db.exec("PRAGMA temp_store = MEMORY");
  db.exec(`PRAGMA foreign_keys = ${config.pragma.foreignKeys ? "ON" : "OFF"}`);

  const walResidue = detectWalResidue(targetPath);
  if (walResidue !== null && (walResidue.walFileExists || walResidue.shmFileExists)) {
    console.info(
      `[db] startup detected WAL residue for '${targetPath}' (wal=${walResidue.walFileExists}, shm=${walResidue.shmFileExists})`,
    );
    performWalCheckpoint(db, targetPath, "startup-recovery");
  }

  performStartupIntegrityCheck(db, targetPath, config.maintenance.startupIntegrityCheck);
  performStartupFts5IntegrityCheck(db, targetPath, config.maintenance.startupFts5IntegrityCheck);

  databaseSingleton = db;
  databaseSingletonPath = targetPath;
  setupPeriodicWalCheckpoint(db, targetPath, config.maintenance.walCheckpointIntervalMs);

  return db;
}

/**
 * Close and reset the shared database instance.
 *
 * Debug tip: call this in test cleanup to avoid stale file locks.
 */
export function closeDatabase(): void {
  if (databaseSingleton === null) {
    return;
  }

  const db = databaseSingleton;
  const databasePath = databaseSingletonPath;

  if (walCheckpointTimer !== null) {
    clearTimeout(walCheckpointTimer);
    walCheckpointTimer = null;
  }

  performWalCheckpoint(db, databasePath, "closeDatabase");

  try {
    db.close(false);
  } catch (error) {
    console.error(`[db] closeDatabase close failed for '${databasePath ?? "unknown"}'`, error);
  } finally {
    databaseSingleton = null;
    databaseSingletonPath = null;
  }
}

function detectWalResidue(databasePath: string): WalResidueDetection | null {
  if (databasePath === ":memory:" || databasePath.length === 0) {
    return null;
  }

  return {
    walFileExists: existsSync(`${databasePath}-wal`),
    shmFileExists: existsSync(`${databasePath}-shm`),
  };
}

function performWalCheckpoint(db: Database, databasePath: string | null, source: string): void {
  try {
    const checkpointRow = db.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as WalCheckpointRow | null;
    if (checkpointRow?.busy !== undefined && checkpointRow.busy > 0) {
      console.warn(
        `[db] ${source} checkpoint returned busy=${checkpointRow.busy} for '${databasePath ?? "unknown"}'`,
      );
    } else {
      console.info(`[db] ${source} checkpoint completed for '${databasePath ?? "unknown"}'`);
    }
  } catch (error) {
    // If checkpoint fails, continue lifecycle to avoid dangling singleton or file locks.
    console.error(`[db] ${source} checkpoint failed for '${databasePath ?? "unknown"}'`, error);
  }
}

function setupPeriodicWalCheckpoint(db: Database, databasePath: string, intervalMs: number): void {
  if (intervalMs <= 0) {
    return;
  }

  const scheduleNextCheckpoint = (): void => {
    walCheckpointTimer = setTimeout(() => {
      performWalCheckpoint(db, databasePath, "periodic-checkpoint");

      if (walCheckpointTimer === null) {
        return;
      }

      scheduleNextCheckpoint();
    }, intervalMs);

    // Timer should not keep process alive during shutdown in tests and CLI workloads.
    walCheckpointTimer.unref?.();
  };

  scheduleNextCheckpoint();
}

function performStartupIntegrityCheck(db: Database, databasePath: string, mode: "OFF" | "QUICK" | "FULL"): void {
  if (mode === "OFF") {
    return;
  }

  try {
    const result = mode === "QUICK" ? runQuickCheck(db) : runIntegrityCheck(db);
    if (result.ok) {
      console.info(`[db] startup ${result.mode}_check passed for '${databasePath}'`);
      return;
    }

    console.error(
      `[db] startup ${result.mode}_check failed for '${databasePath}': ${result.messages.join(" | ")}`,
    );
  } catch (error) {
    console.error(`[db] startup integrity check failed for '${databasePath}'`, error);
  }
}

function performStartupFts5IntegrityCheck(db: Database, databasePath: string, mode: "OFF" | "QUICK" | "FULL"): void {
  if (mode === "OFF") {
    return;
  }

  try {
    const result = runFts5IntegrityCheck(db, mode);
    if (result.ok) {
      console.info(`[db] startup fts5 integrity check (${mode}) passed for '${databasePath}'`);
      return;
    }

    console.error(
      `[db] startup fts5 integrity check (${mode}) failed for '${databasePath}': ${result.issues.join(" | ")}`,
    );
  } catch (error) {
    console.error(`[db] startup fts5 integrity check failed for '${databasePath}'`, error);
  }
}

/**
 * Initialize schema objects and return the same handle.
 */
export function initDatabase(db: Database): Database {
  initSchema(db);
  return db;
}

export function initSchema(db: Database) {
  ensureMemoriesTable(db);
  addScoreColumnToMemories(db);
  createScoreIndexOnMemories(db);
  initializeExistingMemoryScores(db);
  ensureMemoryLinksTable(db);
  ensureKvCacheTable(db);

  // Query performance indexes for common lookup paths.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_links_from_key ON memory_links(from_key)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_links_to_key ON memory_links(to_key)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_links_link_type ON memory_links(link_type)
  `);

  ensureMemoriesFtsObjects(db);
}

/**
 * Run FTS5 optimize command for `memories_fts`.
 *
 * Debug tip: if this fails, verify SQLite build has FTS5 enabled and table exists.
 */
export function optimizeFtsIndex(db: Database): void {
  db.query("INSERT INTO memories_fts(memories_fts) VALUES('optimize')").run();
}

/**
 * Rebuild FTS5 index by dropping and recreating FTS objects.
 *
 * Debug tip: if results are still empty after rebuild, inspect `memories` row count
 * and verify triggers were re-created.
 */
export function rebuildFtsIndex(db: Database): void {
  dropMemoriesFtsObjects(db);
  ensureMemoriesFtsObjects(db);

  // Backfill existing rows from external-content table.
  db.query("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')").run();
}

type SqliteTableColumn = {
  name: string;
};

/**
 * Ensure `memories` table follows the canonical KV schema.
 *
 * Debug tip: if boot fails after upgrade, inspect legacy columns in `PRAGMA table_info(memories)`.
 */
function ensureMemoriesTable(db: Database): void {
  const tableExists =
    (db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memories' LIMIT 1")
      .get() as { name: string } | null) !== null;

  if (!tableExists) {
    createMemoriesTable(db);
    return;
  }

  const columns = db.query("PRAGMA table_info(memories)").all() as SqliteTableColumn[];
  const columnNames = new Set(columns.map((column) => column.name));
  const requiredColumns = ["key", "summary", "text", "meta", "created_at"];
  const hasRequiredShape = requiredColumns.every((column) => columnNames.has(column));
  const hasNamespaceColumn = columnNames.has("namespace");

  if (hasRequiredShape && !hasNamespaceColumn) {
    return;
  }

  resetMemoriesTable(db);
}

/**
 * Create canonical `memories` table schema.
 */
function createMemoriesTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      key TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      text TEXT NOT NULL,
      meta TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
}

/**
 * Ensure `memory_links` table exists and includes required columns.
 */
function ensureMemoryLinksTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_key TEXT NOT NULL,
      to_key TEXT NOT NULL,
      link_type TEXT DEFAULT 'association',
      term TEXT NOT NULL DEFAULT '',
      weight REAL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      access_count INTEGER DEFAULT 0,
      last_accessed_at INTEGER,
      UNIQUE(from_key, to_key, link_type),
      FOREIGN KEY (from_key) REFERENCES memories(key) ON DELETE CASCADE,
      FOREIGN KEY (to_key) REFERENCES memories(key) ON DELETE CASCADE
    )
  `);

  const columns = db.query("PRAGMA table_info(memory_links)").all() as SqliteTableColumn[];
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("term")) {
    db.exec("ALTER TABLE memory_links ADD COLUMN term TEXT NOT NULL DEFAULT ''");
  }
}

/**
 * Ensure key-value cache table exists.
 */
function ensureKvCacheTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER
    )
  `);
}

/**
 * Reset incompatible `memories` table without migrating old data.
 *
 * This project intentionally drops old database records when schema changes.
 */
function resetMemoriesTable(db: Database): void {
  db.exec("PRAGMA foreign_keys = OFF");

  try {
    db.exec("DROP TABLE IF EXISTS memory_links");
    db.exec("DROP TABLE IF EXISTS memories");
    createMemoriesTable(db);
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Ensure FTS table/trigger shape matches current `memories` text column.
 */
function ensureMemoriesFtsObjects(db: Database): void {
  const ftsExists =
    (db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memories_fts' LIMIT 1")
      .get() as { name: string } | null) !== null;

  let shouldRecreateFts = !ftsExists;
  if (ftsExists) {
    const columns = db.query("PRAGMA table_info(memories_fts)").all() as SqliteTableColumn[];
    const names = new Set(columns.map((column) => column.name));
    shouldRecreateFts = !names.has("text");
  }

  if (shouldRecreateFts) {
    dropMemoriesFtsObjects(db);

    // FTS5 index uses external-content mode to avoid duplicating memory payload in index storage.
    // Debug tip: if search returns empty after existing data import, run FTS rebuild for historical rows.
    db.exec(`
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        key,
        summary,
        text,
        content='memories',
        content_rowid='rowid'
      )
    `);
  }

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, key, summary, text) 
      VALUES (new.rowid, new.key, new.summary, new.text);
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, key, summary, text) 
      VALUES ('delete', old.rowid, old.key, old.summary, old.text);
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, key, summary, text) 
      VALUES ('delete', old.rowid, old.key, old.summary, old.text);
      INSERT INTO memories_fts(rowid, key, summary, text) 
      VALUES (new.rowid, new.key, new.summary, new.text);
    END
  `);
}

/**
 * Drop all FTS5 objects related to memories search.
 */
function dropMemoriesFtsObjects(db: Database): void {
  db.exec("DROP TRIGGER IF EXISTS memories_fts_insert");
  db.exec("DROP TRIGGER IF EXISTS memories_fts_delete");
  db.exec("DROP TRIGGER IF EXISTS memories_fts_update");
  db.exec("DROP TABLE IF EXISTS memories_fts");
}
