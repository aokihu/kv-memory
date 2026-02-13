import { Database } from "bun:sqlite";

/**
 * Database migration helpers for KV memory storage.
 */

type SqliteTableInfoRow = {
  name: string;
};

/**
 * Add `score` column to `memories` table.
 *
 * Debug tip: if migration wiring fails, verify caller passes a valid opened Database instance.
 */
export function addScoreColumnToMemories(db: Database): void {
  try {
    const tableColumns = db.query("PRAGMA table_info(memories)").all() as SqliteTableInfoRow[];
    const hasScoreColumn = tableColumns.some((column) => column.name === "score");

    // Idempotent guard: repeated migration runs should skip ALTER when column already exists.
    if (hasScoreColumn) {
      console.info("[migration] score column already exists on memories table, skipping");
      return;
    }

    db.exec(
      "ALTER TABLE memories ADD COLUMN score INTEGER DEFAULT 50 CHECK (score >= 0 AND score <= 100)",
    );

    console.info("[migration] added score column to memories table");
  } catch (error) {
    // Debug entry: start from this log to inspect SQL execution failures and table state.
    console.error("[migration] failed to add score column to memories table", error);
    throw error;
  }
}

/**
 * Create index on `memories.score` for score-based queries.
 *
 * Debug tip: if index creation fails, verify `memories` table exists and schema migration order is correct.
 */
export function createScoreIndexOnMemories(db: Database): void {
  try {
    // Idempotent DDL: safe to run repeatedly across startup and migration retries.
    db.exec("CREATE INDEX IF NOT EXISTS idx_memories_score ON memories(score)");
    console.info("[migration] ensured idx_memories_score index exists on memories(score)");
  } catch (error) {
    // Debug entry: inspect DB schema and migration execution order when index creation throws.
    console.error("[migration] failed to create idx_memories_score index on memories(score)", error);
    throw error;
  }
}

/**
 * Initialize `score` for existing memories that still have NULL values.
 *
 * Debug tip: if updated count is unexpectedly high/low, inspect rows where `score IS NULL` before and after migration.
 */
export function initializeExistingMemoryScores(db: Database): void {
  try {
    const updateResult = db.query("UPDATE memories SET score = 50 WHERE score IS NULL").run();
    const updatedRowCount = updateResult.changes;

    // Idempotent behavior: repeated runs only target rows that are still uninitialized.
    console.info(
      `[migration] initialized score=50 for existing memories with NULL score, updated rows: ${updatedRowCount}`,
    );
  } catch (error) {
    // Debug entry: start from this log to inspect SQL execution failures and memory row state.
    console.error("[migration] failed to initialize score for existing memories", error);
    throw error;
  }
}
