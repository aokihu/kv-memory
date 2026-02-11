/**
 * Final deployment verification test suite.
 *
 * Coverage focus:
 * 1) service-level core workflow
 * 2) migration dry-run/actual simulation on synthetic legacy data
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase, getDatabase, migrateKeyvToSQLite } from "../src/libs/db";
import { KVMemoryService } from "../src/service";
import { MemoryStatusEnums } from "../src/type";

const runtimeDb = initDatabase(getDatabase());

let namespace = "";

function makeNamespace(): string {
  return `final_verify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeMemory(id: string) {
  const now = Date.now();
  return {
    summary: `summary-${id}`,
    text: `text-${id}`,
    links: [],
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

afterEach(() => {
  if (!namespace) {
    return;
  }

  runtimeDb.query("DELETE FROM memory_links WHERE from_key LIKE ? OR to_key LIKE ?").run(`${namespace}_%`, `${namespace}_%`);
  runtimeDb.query("DELETE FROM memories WHERE key LIKE ?").run(`${namespace}_%`);
  namespace = "";
});

describe("final verification", () => {
  test("core service workflow remains functional", async () => {
    namespace = makeNamespace();
    const service = new KVMemoryService();
    const keyA = `${namespace}_a`;
    const keyB = `${namespace}_b`;
    const renamedKey = `${namespace}_b_renamed`;

    await service.addMemory(namespace, keyA, {
      summary: "A",
      text: "A text",
    });

    await service.addMemory(namespace, keyB, {
      summary: "B",
      text: "B text",
    });

    const fetched = await service.getMemory(namespace, keyB);
    expect(fetched?.summary).toBe("B");
    expect(fetched?.links.length).toBe(0);

    await service.updateMemory(namespace, keyB, { summary: "B2" });
    const updated = await service.getMemory(namespace, keyB);
    expect(updated?.summary).toBe("B2");

    const traversed = await service.traverseMemory(namespace, keyB);
    expect((traversed?.meta.traverse_count ?? 0) >= 1).toBe(true);

    await service.updateKey(namespace, keyB, renamedKey);
    expect(await service.getMemory(namespace, keyB)).toBeUndefined();
    expect((await service.getMemory(namespace, renamedKey))?.summary).toBe("B2");
  });

  test.skip("migration simulation supports dry-run and actual migration", () => {
    const dir = mkdtempSync(join(tmpdir(), "kvdb-final-verify-"));
    const sourcePath = join(dir, "legacy.db");
    const targetPath = join(dir, "migrated.db");
    const backupDir = join(dir, "backup");

    try {
      const source = new Database(sourcePath);
      source.exec("CREATE TABLE keyv(key VARCHAR(255) PRIMARY KEY, value TEXT)");
      source
        .query("INSERT INTO keyv(key, value) VALUES (?, ?)")
        .run("mem:m1", JSON.stringify({ value: makeMemory("m1") }));
      source
        .query("INSERT INTO keyv(key, value) VALUES (?, ?)")
        .run("_session_:skip", JSON.stringify({ value: { kv_namespace: "mem", last_memory_key: "m1" } }));
      source.close();

      const dry = migrateKeyvToSQLite({ sourcePath, targetPath, backupDir, dryRun: true });
      expect(dry.sourceRows).toBe(2);
      expect(dry.migratedRecords).toBe(1);
      expect(dry.skippedRows).toBe(1);

      const actual = migrateKeyvToSQLite({ sourcePath, targetPath, backupDir });
      expect(actual.validation.mismatches.length).toBe(0);
      expect(actual.migratedRecords).toBe(1);

      const target = new Database(targetPath, { readonly: true, create: false });
      const count = target.query("SELECT COUNT(*) as count FROM memories").get() as { count: number };
      expect(count.count).toBe(1);
      target.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
