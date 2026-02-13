/**
 * Concurrency safety tests for decay processor.
 * Focuses on optimistic lock retries, transaction atomicity, scheduler overlap,
 * deadlock avoidance, and post-run data integrity.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  OptimisticLockConflictError,
  getMemoryVersion,
  processMemoriesInBatches,
  updateMemoryMetaWithOptimisticLock,
} from "../src/libs/decay/processor";

type MemoryRow = {
  key: string;
  summary: string;
  text: string;
  meta: string;
  score: number;
  created_at: number;
};

const openDatabases: Database[] = [];
const tempDirectories: string[] = [];

function trackDatabase(db: Database): Database {
  openDatabases.push(db);
  return db;
}

function createMemorySchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      key TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      text TEXT NOT NULL,
      meta TEXT,
      score INTEGER DEFAULT 50,
      created_at INTEGER NOT NULL
    );
  `);
}

function seedMemories(db: Database, count: number, baseScore: number = 50): void {
  const insert = db.query(
    "INSERT INTO memories (key, summary, text, meta, score, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const now = Date.now();

  for (let index = 0; index < count; index += 1) {
    const key = `k-${index.toString().padStart(3, "0")}`;
    insert.run(
      key,
      `summary-${index}`,
      `text-${index}`,
      JSON.stringify({ version: 0, access_count: 0, last_accessed_at: now }),
      baseScore,
      now,
    );
  }
}

function readMeta(db: Database, key: string): Record<string, unknown> {
  const row = db.query("SELECT meta FROM memories WHERE key = ?").get(key) as { meta?: string } | null;
  if (!row || typeof row.meta !== "string") {
    throw new Error(`Missing meta for key: ${key}`);
  }
  return JSON.parse(row.meta) as Record<string, unknown>;
}

function readAllRows(db: Database): MemoryRow[] {
  return db.query("SELECT key, summary, text, meta, score, created_at FROM memories ORDER BY key ASC").all() as MemoryRow[];
}

function createInMemoryDb(seedCount: number): Database {
  const db = trackDatabase(new Database(":memory:"));
  createMemorySchema(db);
  seedMemories(db, seedCount);
  return db;
}

function createFileBackedDbPair(seedCount: number): { dbA: Database; dbB: Database } {
  const directory = mkdtempSync(join(tmpdir(), "decay-concurrent-"));
  tempDirectories.push(directory);
  const dbPath = join(directory, "memories.sqlite");
  const dbA = trackDatabase(new Database(dbPath));
  const dbB = trackDatabase(new Database(dbPath));

  dbA.exec("PRAGMA journal_mode = WAL;");
  dbA.exec("PRAGMA busy_timeout = 1000;");
  dbB.exec("PRAGMA busy_timeout = 1000;");
  createMemorySchema(dbA);
  seedMemories(dbA, seedCount);

  return { dbA, dbB };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout in ${label} after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function assertDataIntegrity(db: Database, expectedCount: number): void {
  const rows = readAllRows(db);
  expect(rows.length).toBe(expectedCount);

  for (const row of rows) {
    expect(typeof row.key).toBe("string");
    expect(row.summary.length).toBeGreaterThan(0);
    expect(row.text.length).toBeGreaterThan(0);
    expect(Number.isFinite(row.score)).toBe(true);
    expect(row.score).toBeGreaterThanOrEqual(0);
    expect(row.score).toBeLessThanOrEqual(100);
    const parsedMeta = JSON.parse(row.meta) as Record<string, unknown>;
    const version = getMemoryVersion(parsedMeta);
    expect(version).toBeGreaterThanOrEqual(0);
  }
}

afterEach(() => {
  while (openDatabases.length > 0) {
    const db = openDatabases.pop();
    if (!db) {
      continue;
    }
    try {
      db.close();
    } catch {
      // Cleanup should be best-effort to keep repeat runs stable.
    }
  }

  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (!directory) {
      continue;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("decay processor concurrency safety", () => {
  it("detects optimistic lock conflicts and succeeds with retry", async () => {
    const db = createInMemoryDb(1);
    const targetKey = "k-000";

    const v1 = await updateMemoryMetaWithOptimisticLock(
      db,
      targetKey,
      0,
      { access_count: 1, touched_by: "first" },
      61,
      { maxConflictRetries: 0 },
    );
    expect(v1).toBe(1);

    await expect(
      updateMemoryMetaWithOptimisticLock(db, targetKey, 0, { touched_by: "stale" }, undefined, {
        maxConflictRetries: 0,
      }),
    ).rejects.toBeInstanceOf(OptimisticLockConflictError);

    const retriedVersion = await updateMemoryMetaWithOptimisticLock(
      db,
      targetKey,
      0,
      { access_count: 2, touched_by: "retry-success" },
      62,
      { maxConflictRetries: 3, conflictRetryDelayMs: 1 },
    );

    expect(retriedVersion).toBe(2);
    const meta = readMeta(db, targetKey);
    expect(getMemoryVersion(meta)).toBe(2);
    expect(meta.access_count).toBe(2);
  });

  it("keeps batch transaction atomic when one memory processing fails", async () => {
    const db = createInMemoryDb(6);

    const stats = await processMemoriesInBatches(
      db,
      { batchSize: 3, maxRetries: 0, retryDelayMs: 0, transactionTimeoutMs: 200 } as any,
      3,
      async (memory) => {
        db.query("UPDATE memories SET score = ? WHERE key = ?").run(99, memory.key);
        if (memory.key === "k-001") {
          throw new Error("forced-batch-failure");
        }
      },
    );

    expect(stats.failedBatches).toBe(1);
    expect(stats.processedBatches).toBe(1);
    expect(stats.processedMemories).toBe(3);

    const rows = readAllRows(db);
    const scoreByKey = new Map(rows.map((row) => [row.key, row.score]));

    // Failed first batch is rolled back fully.
    expect(scoreByKey.get("k-000")).toBe(50);
    expect(scoreByKey.get("k-001")).toBe(50);
    expect(scoreByKey.get("k-002")).toBe(50);
    // Next batch still commits normally.
    expect(scoreByKey.get("k-003")).toBe(99);
    expect(scoreByKey.get("k-004")).toBe(99);
    expect(scoreByKey.get("k-005")).toBe(99);
  });

  it("handles high-contention concurrent updates without data corruption", async () => {
    const db = createInMemoryDb(1);
    const targetKey = "k-000";

    const workerCount = 20;
    const tasks = Array.from({ length: workerCount }, (_, index) =>
      (async () => {
        await sleep(index % 5);
        try {
          const version = await updateMemoryMetaWithOptimisticLock(
            db,
            targetKey,
            0,
            { worker: `w-${index}` },
            70,
            { maxConflictRetries: 4, conflictRetryDelayMs: 1 },
          );
          return { ok: true, version };
        } catch (error) {
          if (error instanceof OptimisticLockConflictError) {
            return { ok: false, version: null };
          }
          throw error;
        }
      })(),
    );

    const results = await Promise.all(tasks);
    const successCount = results.filter((item) => item.ok).length;
    expect(successCount).toBeGreaterThan(0);

    const meta = readMeta(db, targetKey);
    expect(getMemoryVersion(meta)).toBe(successCount);
    assertDataIntegrity(db, 1);
  });

  it("keeps multi-connection concurrent batch processing deadlock-free", async () => {
    const { dbA, dbB } = createFileBackedDbPair(6);
    const keys = readAllRows(dbA).map((row) => row.key);

    const tasks: Array<Promise<void>> = [];
    for (const [index, key] of keys.entries()) {
      tasks.push(
        (async () => {
          await sleep(index % 2);
          try {
            await updateMemoryMetaWithOptimisticLock(
              dbA,
              key,
              0,
              { worker: "A", touched_at: Date.now() },
              75,
              { maxConflictRetries: 3, conflictRetryDelayMs: 1 },
            );
          } catch (error) {
            if (!(error instanceof OptimisticLockConflictError)) {
              throw error;
            }
          }
        })(),
      );

      tasks.push(
        (async () => {
          await sleep((index + 1) % 2);
          try {
            await updateMemoryMetaWithOptimisticLock(
              dbB,
              key,
              0,
              { worker: "B", touched_at: Date.now() },
              76,
              { maxConflictRetries: 3, conflictRetryDelayMs: 1 },
            );
          } catch (error) {
            if (!(error instanceof OptimisticLockConflictError)) {
              throw error;
            }
          }
        })(),
      );
    }

    await withTimeout(Promise.all(tasks), 1500, "multi-connection optimistic updates");

    const versions = keys.map((key) => getMemoryVersion(readMeta(dbA, key)));
    expect(versions.some((version) => version > 0)).toBe(true);
    assertDataIntegrity(dbA, 6);
  });

  it("simulates overlapping scheduler ticks and preserves consistency", async () => {
    const db = createInMemoryDb(10);

    const runTick = async (tickId: number) =>
      processMemoriesInBatches(
        db,
        { batchSize: 3, maxRetries: 1, retryDelayMs: 1, transactionTimeoutMs: 300 } as any,
        3,
        async (memory) => {
          const memoryIndex = Number(memory.key.replace("k-", ""));
          await sleep((tickId + memoryIndex) % 3);

          try {
            await updateMemoryMetaWithOptimisticLock(
              db,
              memory.key,
              getMemoryVersion(memory.meta),
              { tick: tickId, last_tick_at: Date.now() },
              Math.min(100, (memory.score ?? 50) + 1),
              { maxConflictRetries: 2, conflictRetryDelayMs: 1 },
            );
          } catch (error) {
            if (!(error instanceof OptimisticLockConflictError)) {
              throw error;
            }
          }
        },
      );

    const tickPromises = Array.from({ length: 5 }, (_, tickId) =>
      (async () => {
        await sleep(tickId);
        return runTick(tickId);
      })(),
    );

    const statsList = await withTimeout(Promise.all(tickPromises), 4000, "overlapping scheduler ticks");
    const retriedOrFailed = statsList.some((stats) => stats.retryCount > 0 || stats.failedBatches > 0);

    // At high contention we expect retry/failure counters to expose race pressure.
    expect(retriedOrFailed).toBe(true);
    assertDataIntegrity(db, 10);
  });
});
