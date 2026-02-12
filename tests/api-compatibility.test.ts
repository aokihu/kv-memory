/**
 * API compatibility tests for KVMemoryService/KVMemory behavior.
 *
 * Goal: verify existing service-level usage patterns still work with SQLite backend.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase, getDatabase } from "../src/libs/kv/db";
import { KVMemoryService } from "../src/service";

const db = initDatabase(getDatabase());

let namespace = "";

function makeNamespace(): string {
  return `api_compat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

afterEach(() => {
  if (!namespace) {
    return;
  }
  db.query("DELETE FROM memory_links WHERE from_key LIKE ? OR to_key LIKE ?").run(`${namespace}_%`, `${namespace}_%`);
  db.query("DELETE FROM memories WHERE key LIKE ?").run(`${namespace}_%`);
  namespace = "";
});

describe("api compatibility", () => {
  test("service add/get/update/traverse/updateKey flow remains compatible", async () => {
    namespace = makeNamespace();
    const service = new KVMemoryService();
    const baseKey = `${namespace}_base`;
    const renamedKey = `${namespace}_renamed`;

    await service.addMemory(namespace, baseKey, {
      summary: "base-summary",
      text: "base-text",
    });

    const fetched = await service.getMemory(namespace, baseKey);
    expect(fetched).toBeDefined();
    expect(fetched?.summary).toBe("base-summary");
    expect(fetched?.text).toBe("base-text");

    await service.updateMemory(namespace, baseKey, {
      summary: "updated-summary",
    });

    const updated = await service.getMemory(namespace, baseKey);
    expect(updated?.summary).toBe("updated-summary");
    expect(updated?.text).toBe("base-text");

    const traversed = await service.traverseMemory(namespace, baseKey);
    expect(traversed).toBeDefined();
    expect((traversed?.meta.traverse_count ?? 0) >= 1).toBe(true);

    await service.updateKey(namespace, baseKey, renamedKey);

    const oldValue = await service.getMemory(namespace, baseKey);
    const renamed = await service.getMemory(namespace, renamedKey);
    expect(oldValue).toBeUndefined();
    expect(renamed?.summary).toBe("updated-summary");
  });

  test("missing namespace and key behavior remains backward compatible", async () => {
    namespace = makeNamespace();
    const service = new KVMemoryService();

    const missingInUnknownNamespace = await service.getMemory("not_exists_namespace", "k");
    expect(missingInUnknownNamespace).toBeUndefined();

    const missingTraverse = await service.traverseMemory(namespace, "missing_key");
    expect(missingTraverse).toBeUndefined();
  });
});
