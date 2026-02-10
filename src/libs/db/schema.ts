import { Database } from "bun:sqlite";
import { getDatabaseConfig } from "./config";

let databaseSingleton: Database | null = null;
let databaseSingletonPath: string | null = null;

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
  db.exec(`PRAGMA busy_timeout = ${config.pragma.busyTimeoutMs}`);
  db.exec(`PRAGMA foreign_keys = ${config.pragma.foreignKeys ? "ON" : "OFF"}`);

  databaseSingleton = db;
  databaseSingletonPath = targetPath;

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

  databaseSingleton.close(false);
  databaseSingleton = null;
  databaseSingletonPath = null;
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

  // Key-value cache for non-memory storage
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER
    )
  `);

  // Links between memories (associative network)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_key TEXT NOT NULL,
      to_key TEXT NOT NULL,
      link_type TEXT DEFAULT 'association',
      weight REAL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      access_count INTEGER DEFAULT 0,
      last_accessed_at INTEGER,
      UNIQUE(from_key, to_key, link_type),
      FOREIGN KEY (from_key) REFERENCES memories(key) ON DELETE CASCADE,
      FOREIGN KEY (to_key) REFERENCES memories(key) ON DELETE CASCADE
    )
  `);

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
  const requiredColumns = ["key", "summary", "text", "meta", "links", "created_at"];
  const hasRequiredShape = requiredColumns.every((column) => columnNames.has(column));
  const hasNamespaceColumn = columnNames.has("namespace");

  if (hasRequiredShape && !hasNamespaceColumn) {
    return;
  }

  migrateLegacyMemoriesTable(db);
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
      links TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    )
  `);
}

/**
 * Migrate legacy `memories` schema (including optional namespace/content fields) to canonical shape.
 *
 * Debug tip: if migrated old rows become unreadable, inspect generated `meta` JSON in this function.
 */
function migrateLegacyMemoriesTable(db: Database): void {
  const legacyRows = db.query("SELECT * FROM memories").all() as Array<Record<string, unknown>>;

  db.exec("PRAGMA foreign_keys = OFF");

  try {
    db.exec("DROP TABLE IF EXISTS memory_links");
    db.exec("ALTER TABLE memories RENAME TO memories_legacy");
    createMemoriesTable(db);

    const insertMemory = db.query(
      `INSERT INTO memories (key, summary, text, meta, links, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const row of legacyRows) {
      const key = typeof row.key === "string" ? row.key : "";
      if (!key) {
        continue;
      }

      const createdAt = toNumber(row.created_at, Date.now());
      const summary = toStringValue(row.summary, "");
      const text = toStringValue(row.text ?? row.content, "");
      const links = toJsonArrayString(row.links);
      const meta = toMetaJsonString(row, key, createdAt);

      insertMemory.run(key, summary, text, meta, links, createdAt);
    }

    db.exec("DROP TABLE memories_legacy");
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Convert unknown value to number with default fallback.
 */
function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

/**
 * Convert unknown value to string with fallback.
 */
function toStringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Normalize array-like JSON column text. Invalid input falls back to empty array.
 */
function toJsonArrayString(value: unknown): string {
  if (typeof value !== "string") {
    return "[]";
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return value;
    }
  } catch {
    // Invalid JSON should not block migration; fallback keeps row readable.
  }

  return "[]";
}

/**
 * Build valid MemoryMeta JSON for migrated rows.
 */
function toMetaJsonString(row: Record<string, unknown>, key: string, createdAt: number): string {
  if (typeof row.meta === "string") {
    try {
      const parsed = JSON.parse(row.meta) as Record<string, unknown>;
      if (parsed && typeof parsed.id === "string") {
        return row.meta;
      }
    } catch {
      // Fall through to regenerated meta payload.
    }
  }

  const now = Date.now();
  const meta = {
    id: key,
    created_at: createdAt,
    last_accessed_at: toNumber(row.last_accessed_at, createdAt),
    last_linked_at: toNumber(row.last_linked_at, createdAt),
    in_degree: toNumber(row.in_degree, 0),
    out_degree: toNumber(row.out_degree, 0),
    access_count: toNumber(row.access_count, 0),
    traverse_count: toNumber(row.traverse_count, 0),
    status: toStringValue(row.status, "active"),
    migrated_at: now,
  };

  return JSON.stringify(meta);
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
    db.exec("DROP TRIGGER IF EXISTS memories_fts_insert");
    db.exec("DROP TRIGGER IF EXISTS memories_fts_delete");
    db.exec("DROP TRIGGER IF EXISTS memories_fts_update");
    db.exec("DROP TABLE IF EXISTS memories_fts");

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
