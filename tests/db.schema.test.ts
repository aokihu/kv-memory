/**
 * SQLite schema bootstrap tests.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDatabase, getDatabase, initDatabase } from "../src/libs/db";

function makeTempDatabasePath(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "kvdb-mem-schema-"));
  const file = join(dir, "schema.test.db");
  return { dir, file };
}

afterEach(() => {
  // Always reset singleton between tests, otherwise database file path lock is expected.
  closeDatabase();
});

beforeEach(() => {
  // Ensure previous suites do not leak singleton before this file starts.
  closeDatabase();
});

describe("db schema", () => {
  test("initDatabase creates required tables and indexes", () => {
    const { dir, file } = makeTempDatabasePath();

    try {
      const db = getDatabase(file);
      initDatabase(db);

      const memoriesTable = db
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("memories") as { name: string } | null;
      const linksTable = db
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("memory_links") as { name: string } | null;

      expect(memoriesTable?.name).toBe("memories");
      expect(linksTable?.name).toBe("memory_links");

      const requiredIndexes = [
        "idx_memories_created_at",
        "idx_memory_links_from_key",
        "idx_memory_links_to_key",
        "idx_memory_links_link_type",
      ];

      for (const indexName of requiredIndexes) {
        const index = db
          .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get(indexName) as { name: string } | null;

        expect(index?.name).toBe(indexName);
      }
    } finally {
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("getDatabase uses singleton and blocks file switching", () => {
    const first = makeTempDatabasePath();
    const second = makeTempDatabasePath();

    try {
      const dbA = getDatabase(first.file);
      const dbARepeat = getDatabase(first.file);
      expect(dbA).toBe(dbARepeat);

      expect(() => getDatabase(second.file)).toThrow(
        `Database singleton already initialized with '${first.file}', cannot switch to '${second.file}'`,
      );
    } finally {
      closeDatabase();
      rmSync(first.dir, { recursive: true, force: true });
      rmSync(second.dir, { recursive: true, force: true });
    }
  });

  test("closeDatabase releases singleton so new file can be opened", () => {
    const first = makeTempDatabasePath();
    const second = makeTempDatabasePath();

    try {
      const dbA = getDatabase(first.file);
      initDatabase(dbA);
      closeDatabase();

      const dbB = getDatabase(second.file);
      initDatabase(dbB);
      expect(existsSync(second.file)).toBe(true);
    } finally {
      closeDatabase();
      rmSync(first.dir, { recursive: true, force: true });
      rmSync(second.dir, { recursive: true, force: true });
    }
  });
});
