/**
 * SQLite schema bootstrap tests.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDatabase, getDatabase, initDatabase } from "../src/libs/kv/db";

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
  test("getDatabase applies crash-safety PRAGMA defaults", () => {
    const { dir, file } = makeTempDatabasePath();

    try {
      const db = getDatabase(file);

      const journalModeRow = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
      const synchronousRow = db.query("PRAGMA synchronous").get() as { synchronous: number };
      const busyTimeoutRow = db.query("PRAGMA busy_timeout").get() as { timeout: number };
      const cacheSizeRow = db.query("PRAGMA cache_size").get() as { cache_size: number };
      const tempStoreRow = db.query("PRAGMA temp_store").get() as { temp_store: number };
      const foreignKeysRow = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };

      expect(journalModeRow.journal_mode.toLowerCase()).toBe("wal");
      // SQLite maps EXTRA to numeric level 3 in PRAGMA readback.
      expect(synchronousRow.synchronous).toBe(3);
      expect(busyTimeoutRow.timeout).toBe(5000);
      expect(cacheSizeRow.cache_size).toBe(-64000);
      // temp_store MEMORY returns numeric enum value 2.
      expect(tempStoreRow.temp_store).toBe(2);
      expect(foreignKeysRow.foreign_keys).toBe(1);
    } finally {
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });

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

  test("closeDatabase performs WAL checkpoint before close", () => {
    const { dir, file } = makeTempDatabasePath();

    try {
      const db = getDatabase(file);
      initDatabase(db);

      const callOrder: string[] = [];
      const originalQuery = db.query.bind(db);
      const originalClose = db.close.bind(db);

      (db as unknown as { query: (sql: string) => unknown }).query = ((sql: string) => {
        if (sql === "PRAGMA wal_checkpoint(TRUNCATE)") {
          callOrder.push("checkpoint");
          return {
            get: () => ({ busy: 0, log: 0, checkpointed: 0 }),
          };
        }
        return originalQuery(sql);
      }) as (sql: string) => unknown;

      (db as unknown as { close: (throwOnError?: boolean) => void }).close = ((throwOnError?: boolean) => {
        callOrder.push("close");
        originalClose(throwOnError);
      }) as (throwOnError?: boolean) => void;

      closeDatabase();

      expect(callOrder).toEqual(["checkpoint", "close"]);
    } finally {
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("closeDatabase continues closing when checkpoint throws", () => {
    const first = makeTempDatabasePath();
    const second = makeTempDatabasePath();

    try {
      const db = getDatabase(first.file);
      initDatabase(db);

      let closeCalls = 0;
      const originalQuery = db.query.bind(db);
      const originalClose = db.close.bind(db);

      (db as unknown as { query: (sql: string) => unknown }).query = ((sql: string) => {
        if (sql === "PRAGMA wal_checkpoint(TRUNCATE)") {
          throw new Error("forced-checkpoint-failure");
        }
        return originalQuery(sql);
      }) as (sql: string) => unknown;

      (db as unknown as { close: (throwOnError?: boolean) => void }).close = ((throwOnError?: boolean) => {
        closeCalls += 1;
        originalClose(throwOnError);
      }) as (throwOnError?: boolean) => void;

      expect(() => closeDatabase()).not.toThrow();
      expect(closeCalls).toBe(1);

      const reopened = getDatabase(second.file);
      initDatabase(reopened);
      expect(existsSync(second.file)).toBe(true);
    } finally {
      closeDatabase();
      rmSync(first.dir, { recursive: true, force: true });
      rmSync(second.dir, { recursive: true, force: true });
    }
  });

  test("getDatabase detects WAL residue and runs startup recovery checkpoint", () => {
    const { dir, file } = makeTempDatabasePath();
    const originalInfo = console.info;
    const infoLogs: string[] = [];

    try {
      writeFileSync(file, "");
      writeFileSync(`${file}-wal`, "residue");
      writeFileSync(`${file}-shm`, "residue");
      console.info = (message?: unknown, ...optionalParams: unknown[]) => {
        infoLogs.push(String(message ?? ""));
        if (optionalParams.length > 0) {
          infoLogs.push(optionalParams.map((item) => String(item)).join(" "));
        }
      };

      const db = getDatabase(file);
      initDatabase(db);

      expect(infoLogs.some((line) => line.includes("startup detected WAL residue"))).toBe(true);
      expect(infoLogs.some((line) => line.includes("startup-recovery checkpoint completed"))).toBe(true);
    } finally {
      console.info = originalInfo;
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("getDatabase schedules periodic WAL checkpoint and closeDatabase clears it", () => {
    const { dir, file } = makeTempDatabasePath();
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timerRef = {
      unrefCalled: false,
      unref() {
        this.unrefCalled = true;
      },
    };

    let scheduledIntervalMs = -1;
    let clearCalled = false;

    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      _handler: unknown,
      timeout?: unknown,
    ) => {
      scheduledIntervalMs = Number(timeout ?? 0);
      return timerRef as unknown;
    }) as unknown as typeof setTimeout;

    (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = ((timer: unknown) => {
      if (timer === timerRef) {
        clearCalled = true;
      }
    }) as unknown as typeof clearTimeout;

    try {
      const db = getDatabase(file);
      initDatabase(db);

      expect(scheduledIntervalMs).toBe(60000);
      expect(timerRef.unrefCalled).toBe(true);

      closeDatabase();

      expect(clearCalled).toBe(true);
    } finally {
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = originalSetTimeout;
      (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = originalClearTimeout;
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
