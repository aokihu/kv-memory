import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateKeyvToSQLite } from "../src/libs/db";
import { MemoryStatusEnums, type Memory } from "../src/type";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "kvdb-migration-"));
}

function makeMemory(id: string, summary: string, links: Memory["links"] = []): Memory {
  const now = Date.now();
  return {
    domain: "test",
    summary,
    text: `${summary}-text`,
    type: "decision",
    keywords: [summary],
    links,
    meta: {
      id,
      created_at: now,
      last_accessed_at: now,
      last_linked_at: now,
      in_degree: 0,
      out_degree: 0,
      access_count: 0,
      traverse_count: 0,
      status: MemoryStatusEnums.parse("active"),
    },
  };
}

describe("db migration", () => {
  test("migrate keyv rows into memories and memory_links with idempotency", () => {
    const dir = makeTempDir();
    const sourcePath = join(dir, "source.db");
    const targetPath = join(dir, "target.db");
    const backupDir = join(dir, "backup");

    try {
      const source = new Database(sourcePath);
      source.exec("CREATE TABLE keyv(key VARCHAR(255) PRIMARY KEY, value TEXT)");

      const memoryA = makeMemory("a", "summary-a", [
        { type: "decision", key: "b", term: "to-b", weight: 0.6 },
        { type: "design", term: "no-key-link", weight: 0.2 },
      ]);
      const memoryB = makeMemory("b", "summary-b");

      const insert = source.query("INSERT INTO keyv(key, value) VALUES (?, ?)");
      insert.run("mem:a", JSON.stringify({ value: memoryA }));
      insert.run("mem:b", JSON.stringify({ value: memoryB }));
      insert.run("_session_:abc", JSON.stringify({ value: { kv_namespace: "mem", last_memory_key: "a" } }));
      source.close();

      const first = migrateKeyvToSQLite({ sourcePath, targetPath, backupDir });
      expect(first.sourceRows).toBe(3);
      expect(first.migratedRecords).toBe(2);
      expect(first.skippedRows).toBe(1);
      expect(first.validation.mismatches.length).toBe(0);
      expect(existsSync(first.backup.backupPath)).toBe(true);

      const target = new Database(targetPath);
      const memoryCount = target.query("SELECT COUNT(*) as count FROM memories").get() as { count: number };
      const linkCount = target.query("SELECT COUNT(*) as count FROM memory_links").get() as { count: number };
      expect(memoryCount.count).toBe(2);
      expect(linkCount.count).toBe(1);
      target.close();

      const second = migrateKeyvToSQLite({ sourcePath, targetPath, backupDir });
      expect(second.migratedRecords).toBe(2);
      expect(second.validation.mismatches.length).toBe(0);

      const targetAgain = new Database(targetPath);
      const memoryCountAgain = targetAgain.query("SELECT COUNT(*) as count FROM memories").get() as { count: number };
      const linkCountAgain = targetAgain.query("SELECT COUNT(*) as count FROM memory_links").get() as { count: number };
      expect(memoryCountAgain.count).toBe(2);
      expect(linkCountAgain.count).toBe(1);
      targetAgain.close();

      const sourceCheck = new Database(sourcePath, { readonly: true, create: false });
      const sourceRows = sourceCheck.query("SELECT COUNT(*) as count FROM keyv").get() as { count: number };
      expect(sourceRows.count).toBe(3);
      sourceCheck.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("migrate CLI supports command line invocation", () => {
    const dir = makeTempDir();
    const sourcePath = join(dir, "cli-source.db");
    const targetPath = join(dir, "cli-target.db");
    const backupDir = join(dir, "backup");

    try {
      const source = new Database(sourcePath);
      source.exec("CREATE TABLE keyv(key VARCHAR(255) PRIMARY KEY, value TEXT)");
      source
        .query("INSERT INTO keyv(key, value) VALUES (?, ?)")
        .run("mem:cli", JSON.stringify({ value: makeMemory("cli", "cli-summary") }));
      source.close();

      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          "src/libs/db/migrate.ts",
          "--source",
          sourcePath,
          "--target",
          targetPath,
          "--backup-dir",
          backupDir,
        ],
        cwd: "/home/aokihu/Projects/git/kvdb-mem",
      });

      expect(result.exitCode).toBe(0);

      const output = Buffer.from(result.stdout).toString("utf8");
      const report = JSON.parse(output) as { migratedRecords: number; validation: { mismatches: string[] } };
      expect(report.migratedRecords).toBe(1);
      expect(report.validation.mismatches.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
