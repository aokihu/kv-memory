/**
 * SQLite integrity helper tests.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDatabase, runFts5IntegrityCheck, runIntegrityCheck, runQuickCheck } from "../src/libs/kv/db";

const openedDatabases: Database[] = [];

function createInMemoryDatabase(): Database {
  const db = new Database(":memory:");
  openedDatabases.push(db);
  return db;
}

afterEach(() => {
  for (const db of openedDatabases) {
    db.close();
  }
  openedDatabases.length = 0;
});

describe("db integrity helpers", () => {
  test("runQuickCheck returns ok for valid database", () => {
    const db = createInMemoryDatabase();
    db.exec("CREATE TABLE integrity_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    db.query("INSERT INTO integrity_items (value) VALUES (?)").run("ok");

    const result = runQuickCheck(db);

    expect(result.mode).toBe("quick");
    expect(result.ok).toBe(true);
    expect(result.messages).toEqual(["ok"]);
  });

  test("runIntegrityCheck returns ok for valid database", () => {
    const db = createInMemoryDatabase();
    db.exec("CREATE TABLE integrity_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    db.query("INSERT INTO integrity_items (value) VALUES (?)").run("ok");

    const result = runIntegrityCheck(db);

    expect(result.mode).toBe("full");
    expect(result.ok).toBe(true);
    expect(result.messages).toEqual(["ok"]);
  });

  test("runQuickCheck reports non-ok results from pragma output", () => {
    const db = createInMemoryDatabase();
    const originalQuery = db.query.bind(db);

    (db as unknown as { query: (sql: string) => unknown }).query = ((sql: string) => {
      if (sql === "PRAGMA quick_check") {
        return {
          all: () => [{ quick_check: "row 1 missing" }],
        };
      }
      return originalQuery(sql);
    }) as (sql: string) => unknown;

    const result = runQuickCheck(db);

    expect(result.ok).toBe(false);
    expect(result.messages).toEqual(["row 1 missing"]);
  });

  test("runFts5IntegrityCheck QUICK fails when memories_fts table is missing", () => {
    const db = createInMemoryDatabase();
    db.exec("CREATE TABLE memories (key TEXT PRIMARY KEY, summary TEXT NOT NULL, text TEXT NOT NULL, meta TEXT NOT NULL, created_at INTEGER NOT NULL)");

    const result = runFts5IntegrityCheck(db, "QUICK");

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("missing required table memories_fts");
  });

  test("runFts5IntegrityCheck FULL returns ok for initialized schema", () => {
    const db = createInMemoryDatabase();
    initDatabase(db);
    db.query("INSERT INTO memories (key, summary, text, meta, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "fts:full:test",
      "summary",
      "hello world",
      JSON.stringify({}),
      Date.now(),
    );

    const result = runFts5IntegrityCheck(db, "FULL");

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.checks.some((check) => check.includes("row count matched"))).toBe(true);
  });

  test("runFts5IntegrityCheck FULL detects missing FTS trigger", () => {
    const db = createInMemoryDatabase();
    initDatabase(db);
    db.exec("DROP TRIGGER memories_fts_update");

    const result = runFts5IntegrityCheck(db, "FULL");

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("missing required trigger memories_fts_update");
  });

  test("startup integrity check option runs quick_check when enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "kvdb-integrity-startup-"));
    const file = join(dir, "startup-integrity.db");

    try {
      const startupScript = `
        const { getDatabase, closeDatabase } = require("./src/libs/kv/db");
        const file = process.argv[2];
        const db = getDatabase(file);
        db.exec("CREATE TABLE IF NOT EXISTS startup_integrity_items (id INTEGER PRIMARY KEY)");
        closeDatabase();
      `;
      const result = Bun.spawnSync(["bun", "-e", startupScript, file], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP: "QUICK",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = Buffer.from(result.stdout).toString("utf8");
      const stderr = Buffer.from(result.stderr).toString("utf8");

      expect(result.exitCode).toBe(0);
      expect(stderr.length).toBe(0);
      expect(stdout.includes("startup quick_check passed")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("startup FTS5 integrity check option runs full check when enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "kvdb-fts5-startup-"));
    const file = join(dir, "startup-fts5-integrity.db");

    try {
      const setupScript = `
        const { getDatabase, initDatabase, closeDatabase } = require("./src/libs/kv/db");
        const file = process.argv[2];
        const db = getDatabase(file);
        initDatabase(db);
        db.query("INSERT INTO memories (key, summary, text, meta, created_at) VALUES (?, ?, ?, ?, ?)").run(
          "startup:fts5:test",
          "startup summary",
          "startup text",
          "{}",
          Date.now(),
        );
        closeDatabase();
      `;
      const setupResult = Bun.spawnSync(["bun", "-e", setupScript, file], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP: "OFF",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(setupResult.exitCode).toBe(0);

      const startupScript = `
        const { getDatabase, closeDatabase } = require("./src/libs/kv/db");
        const file = process.argv[2];
        getDatabase(file);
        closeDatabase();
      `;
      const result = Bun.spawnSync(["bun", "-e", startupScript, file], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP: "FULL",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = Buffer.from(result.stdout).toString("utf8");
      const stderr = Buffer.from(result.stderr).toString("utf8");

      expect(result.exitCode).toBe(0);
      expect(stderr.length).toBe(0);
      expect(stdout.includes("startup fts5 integrity check (FULL) passed")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
