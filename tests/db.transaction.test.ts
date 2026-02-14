/**
 * Transaction helper behavior tests.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runBatchInTransaction,
  runInTransaction,
  runInTransactionWithRetry,
} from "../src/libs/kv/db";

const openedDatabases: Database[] = [];

function createInMemoryDatabase(): Database {
  const database = new Database(":memory:");
  openedDatabases.push(database);
  return database;
}

function trackDatabase(database: Database): Database {
  openedDatabases.push(database);
  return database;
}

afterEach(() => {
  for (const database of openedDatabases) {
    database.close();
  }
  openedDatabases.length = 0;
});

describe("db transaction helpers", () => {
  test("runInTransaction rolls back all writes when handler throws", () => {
    const db = createInMemoryDatabase();
    db.exec("CREATE TABLE tx_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");

    expect(() =>
      runInTransaction(db, () => {
        db.query("INSERT INTO tx_items (value) VALUES (?)").run("will-rollback");
        throw new Error("forced failure");
      }),
    ).toThrow("forced failure");

    const row = db.query("SELECT COUNT(*) AS count FROM tx_items").get() as { count: number };
    expect(row.count).toBe(0);
  });

  test("runInTransactionWithRetry retries SQLITE_BUSY with exponential backoff", async () => {
    const db = createInMemoryDatabase();
    let attempts = 0;
    const warnings: string[] = [];

    const result = await runInTransactionWithRetry(
      db,
      () => {
        attempts += 1;
        // Simulate lock contention from concurrent writer.
        if (attempts < 3) {
          throw new Error("SQLITE_BUSY: database is locked");
        }
        return "ok";
      },
      {
        maxAttempts: 5,
        initialDelayMs: 1,
        maxDelayMs: 2,
        logger: {
          warn: (message: string) => warnings.push(message),
        },
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(warnings.length).toBe(2);
  });

  test("runBatchInTransaction keeps batch atomic on single-step failure", () => {
    const db = createInMemoryDatabase();
    db.exec("CREATE TABLE batch_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE)");
    const insertStatement = db.query("INSERT INTO batch_items (value) VALUES (?)");

    expect(() =>
      runBatchInTransaction(db, ["a", "b", "a"], (value) => {
        insertStatement.run(value);
        return value;
      }),
    ).toThrow();

    const row = db.query("SELECT COUNT(*) AS count FROM batch_items").get() as { count: number };
    expect(row.count).toBe(0);
  });

  test("runInTransactionWithRetry resolves real lock contention between connections", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kvdb-transaction-retry-"));
    const file = join(dir, "retry-lock.db");
    const lockerDb = trackDatabase(new Database(file));
    const writerDb = trackDatabase(new Database(file));

    try {
      lockerDb.exec("PRAGMA busy_timeout = 0");
      writerDb.exec("PRAGMA busy_timeout = 0");
      lockerDb.exec("CREATE TABLE IF NOT EXISTS retry_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");

      // Hold a write lock to force SQLITE_BUSY on concurrent writer.
      lockerDb.exec("BEGIN IMMEDIATE");

      setTimeout(() => {
        lockerDb.exec("COMMIT");
      }, 20);

      await runInTransactionWithRetry(
        writerDb,
        () => {
          writerDb.query("INSERT INTO retry_items (value) VALUES (?)").run("from-retry");
        },
        {
          maxAttempts: 10,
          initialDelayMs: 5,
          maxDelayMs: 10,
        },
      );

      const row = writerDb
        .query("SELECT COUNT(*) AS count FROM retry_items WHERE value = ?")
        .get("from-retry") as { count: number };
      expect(row.count).toBe(1);
    } finally {
      writerDb.close();
      lockerDb.close();
      const writerIndex = openedDatabases.indexOf(writerDb);
      if (writerIndex >= 0) {
        openedDatabases.splice(writerIndex, 1);
      }
      const lockerIndex = openedDatabases.indexOf(lockerDb);
      if (lockerIndex >= 0) {
        openedDatabases.splice(lockerIndex, 1);
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
