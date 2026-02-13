/**
 * MEM-DECAY-047 migration tests.
 *
 * Debug entrypoint: if any test becomes flaky, start from `createInMemoryDatabase`
 * and inspect schema state with PRAGMA queries after each migration call.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  addScoreColumnToMemories,
  createScoreIndexOnMemories,
  initializeExistingMemoryScores,
} from "../src/libs/kv/db/migration";

type TableInfoRow = {
  name: string;
};

type IndexListRow = {
  name: string;
};

type MemoryRow = {
  key: string;
  summary: string;
  text: string;
  meta: string;
  created_at: number;
  score: number | null;
};

let db: Database;

function createInMemoryDatabase(): Database {
  return new Database(":memory:");
}

/**
 * Build a pre-migration legacy schema that does not include `score`.
 */
function createLegacyMemoriesTable(database: Database): void {
  database.exec(`
    CREATE TABLE memories (
      key TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      text TEXT NOT NULL,
      meta TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
}

/**
 * Build a post-migration-like schema that contains `score`.
 *
 * Debug tip: use this fixture for initialize/recovery paths where direct control
 * over NULL and non-NULL score rows is required.
 */
function createMemoriesTableWithScore(database: Database): void {
  database.exec(`
    CREATE TABLE memories (
      key TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      text TEXT NOT NULL,
      meta TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      score INTEGER
    )
  `);
}

function insertLegacyMemory(database: Database, key: string, createdAt: number): void {
  database
    .query(
      "INSERT INTO memories (key, summary, text, meta, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(key, `summary-${key}`, `text-${key}`, JSON.stringify({ source: "legacy" }), createdAt);
}

function insertMemoryWithScore(database: Database, key: string, score: number | null): void {
  database
    .query(
      "INSERT INTO memories (key, summary, text, meta, created_at, score) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(key, `summary-${key}`, `text-${key}`, JSON.stringify({ source: "seed" }), Date.now(), score);
}

function getTableColumns(database: Database): string[] {
  const rows = database.query("PRAGMA table_info(memories)").all() as TableInfoRow[];
  return rows.map((row) => row.name);
}

function getScoreIndexNames(database: Database): string[] {
  const rows = database.query("PRAGMA index_list(memories)").all() as IndexListRow[];
  return rows.filter((row) => row.name === "idx_memories_score").map((row) => row.name);
}

describe("kv db migrations - score column/index", () => {
  beforeEach(() => {
    db = createInMemoryDatabase();
  });

  afterEach(() => {
    db.close(false);
  });

  test("adds score column with expected constraints and default behavior", () => {
    createLegacyMemoriesTable(db);
    insertLegacyMemory(db, "legacy-1", 1700000000000);

    addScoreColumnToMemories(db);

    const columns = getTableColumns(db);
    expect(columns).toContain("score");

    const row = db.query("SELECT * FROM memories WHERE key = ?").get("legacy-1") as MemoryRow;
    expect(row.key).toBe("legacy-1");
    expect(row.summary).toBe("summary-legacy-1");
    expect(row.text).toBe("text-legacy-1");
    expect(row.meta).toBe(JSON.stringify({ source: "legacy" }));
    expect(row.created_at).toBe(1700000000000);
    expect(row.score).toBe(50);

    // Constraint check: score out of range should fail after migration.
    expect(() => {
      db.query(
        "INSERT INTO memories (key, summary, text, meta, created_at, score) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("invalid-score", "s", "t", "{}", Date.now(), -1);
    }).toThrow();
  });

  test("creates score index and keeps migration idempotent", () => {
    createLegacyMemoriesTable(db);
    insertLegacyMemory(db, "memory-1", 1700000000001);

    addScoreColumnToMemories(db);
    db.exec("UPDATE memories SET score = NULL WHERE key = 'memory-1'");
    createScoreIndexOnMemories(db);
    initializeExistingMemoryScores(db);

    addScoreColumnToMemories(db);
    createScoreIndexOnMemories(db);
    initializeExistingMemoryScores(db);

    const columns = getTableColumns(db).filter((name) => name === "score");
    expect(columns.length).toBe(1);

    const scoreIndexes = getScoreIndexNames(db);
    expect(scoreIndexes.length).toBe(1);

    const indexColumns = db.query("PRAGMA index_info(idx_memories_score)").all() as TableInfoRow[];
    expect(indexColumns.map((column) => column.name)).toContain("score");

    const row = db.query("SELECT score FROM memories WHERE key = ?").get("memory-1") as {
      score: number;
    };
    expect(row.score).toBe(50);
  });

  test("initializes only NULL scores and preserves existing score values", () => {
    createMemoriesTableWithScore(db);
    insertMemoryWithScore(db, "null-score", null);
    insertMemoryWithScore(db, "existing-score", 91);

    initializeExistingMemoryScores(db);

    const nullScoreRow = db.query("SELECT score FROM memories WHERE key = ?").get("null-score") as {
      score: number;
    };
    const existingScoreRow = db
      .query("SELECT score FROM memories WHERE key = ?")
      .get("existing-score") as { score: number };

    expect(nullScoreRow.score).toBe(50);
    expect(existingScoreRow.score).toBe(91);
  });

  test("handles migration failure and supports recovery after schema fix", () => {
    expect(() => addScoreColumnToMemories(db)).toThrow();
    expect(() => createScoreIndexOnMemories(db)).toThrow();
    expect(() => initializeExistingMemoryScores(db)).toThrow();

    createLegacyMemoriesTable(db);
    insertLegacyMemory(db, "recovery-row", 1700000000099);

    addScoreColumnToMemories(db);
    createScoreIndexOnMemories(db);
    initializeExistingMemoryScores(db);

    const columns = getTableColumns(db);
    expect(columns).toContain("score");

    const indexes = getScoreIndexNames(db);
    expect(indexes.length).toBe(1);

    const row = db.query("SELECT score FROM memories WHERE key = ?").get("recovery-row") as {
      score: number;
    };
    expect(row.score).toBe(50);
  });

  test("supports boundary case with empty memories table", () => {
    createLegacyMemoriesTable(db);

    expect(() => addScoreColumnToMemories(db)).not.toThrow();
    expect(() => createScoreIndexOnMemories(db)).not.toThrow();
    expect(() => initializeExistingMemoryScores(db)).not.toThrow();

    const countRow = db.query("SELECT COUNT(*) as count FROM memories").get() as { count: number };
    expect(countRow.count).toBe(0);
    expect(getScoreIndexNames(db).length).toBe(1);
  });
});
