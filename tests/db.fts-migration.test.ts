/**
 * FTS5 schema migration and synchronization tests.
 *
 * Debug entry point: if any case fails, start from `src/libs/kv/db/schema.ts`
 * and inspect `ensureMemoriesFtsObjects()` plus maintenance helpers.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeDatabase,
  getDatabase,
  initDatabase,
  optimizeFtsIndex,
  rebuildFtsIndex,
} from "../src/libs/kv/db";

function makeTempDatabasePath(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "kvdb-mem-fts-"));
  const file = join(dir, "fts.migration.test.db");
  return { dir, file };
}

afterEach(() => {
  // Reset singleton between tests so each case owns its database file.
  closeDatabase();
});

beforeEach(() => {
  // Defensive cleanup in case previous suites leaked singleton state.
  closeDatabase();
});

describe("db fts migration", () => {
  test("initDatabase creates FTS5 table with expected shape", () => {
    const { dir, file } = makeTempDatabasePath();

    try {
      const db = getDatabase(file);
      initDatabase(db);

      const ftsTable = db
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("memories_fts") as { name: string } | null;
      expect(ftsTable?.name).toBe("memories_fts");

      const ftsColumns = db
        .query("PRAGMA table_info(memories_fts)")
        .all() as Array<{ name: string }>;
      const ftsColumnNames = new Set(ftsColumns.map((column) => column.name));

      expect(ftsColumnNames.has("key")).toBe(true);
      expect(ftsColumnNames.has("summary")).toBe(true);
      expect(ftsColumnNames.has("text")).toBe(true);
    } finally {
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("initDatabase creates FTS triggers and insert trigger indexes new rows", () => {
    const { dir, file } = makeTempDatabasePath();

    try {
      const db = getDatabase(file);
      initDatabase(db);

      const requiredTriggers = [
        "memories_fts_insert",
        "memories_fts_delete",
        "memories_fts_update",
      ];

      for (const triggerName of requiredTriggers) {
        const trigger = db
          .query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get(triggerName) as { name: string } | null;

        expect(trigger?.name).toBe(triggerName);
      }

      db.query(
        "INSERT INTO memories (key, summary, text, meta, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run("demo:memory", "trigger summary", "trigger text payload", "{}", Date.now());

      // If insert trigger fails, this lookup returns null and points to trigger SQL issue.
      const indexedRow = db
        .query("SELECT key FROM memories_fts WHERE memories_fts MATCH ? LIMIT 1")
        .get("trigger") as { key: string } | null;

      expect(indexedRow?.key).toBe("demo:memory");
    } finally {
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("FTS index stays in sync for insert, update, and delete", () => {
    const { dir, file } = makeTempDatabasePath();

    try {
      const db = getDatabase(file);
      initDatabase(db);

      db.query(
        "INSERT INTO memories (key, summary, text, meta, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run("sync:memory", "sync summary", "alpha token", "{}", Date.now());

      const inserted = db
        .query("SELECT key FROM memories_fts WHERE memories_fts MATCH ? LIMIT 1")
        .get("alpha") as { key: string } | null;
      expect(inserted?.key).toBe("sync:memory");

      db.query("UPDATE memories SET text = ?, summary = ? WHERE key = ?").run(
        "beta token",
        "updated summary",
        "sync:memory",
      );

      // If update trigger misses delete+insert sequence, old token can still be searchable.
      const staleAfterUpdate = db
        .query("SELECT key FROM memories_fts WHERE memories_fts MATCH ? LIMIT 1")
        .get("alpha") as { key: string } | null;
      const updated = db
        .query("SELECT key FROM memories_fts WHERE memories_fts MATCH ? LIMIT 1")
        .get("beta") as { key: string } | null;

      expect(staleAfterUpdate).toBeNull();
      expect(updated?.key).toBe("sync:memory");

      db.query("DELETE FROM memories WHERE key = ?").run("sync:memory");

      const afterDelete = db
        .query("SELECT key FROM memories_fts WHERE memories_fts MATCH ? LIMIT 1")
        .get("beta") as { key: string } | null;
      expect(afterDelete).toBeNull();
    } finally {
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("FTS maintenance helpers optimize and rebuild index content", () => {
    const { dir, file } = makeTempDatabasePath();

    try {
      const db = getDatabase(file);
      initDatabase(db);

      db.query(
        "INSERT INTO memories (key, summary, text, meta, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run("maint:memory", "maintenance summary", "delta token", "{}", Date.now());

      optimizeFtsIndex(db);

      db.query("DELETE FROM memories_fts").run();
      const beforeRebuild = db
        .query("SELECT key FROM memories_fts WHERE memories_fts MATCH ? LIMIT 1")
        .get("delta") as { key: string } | null;
      expect(beforeRebuild).toBeNull();

      rebuildFtsIndex(db);

      // Rebuild should backfill from canonical `memories` table after FTS reset.
      const afterRebuild = db
        .query("SELECT key FROM memories_fts WHERE memories_fts MATCH ? LIMIT 1")
        .get("delta") as { key: string } | null;
      expect(afterRebuild?.key).toBe("maint:memory");
    } finally {
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
