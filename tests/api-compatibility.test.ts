/**
 * API compatibility tests for KVMemoryService/KVMemory behavior.
 *
 * Goal: verify existing service-level usage patterns still work with SQLite backend.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase, getDatabase } from "../src/libs/db";
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
  db.query("DELETE FROM memory_links WHERE namespace = ?").run(namespace);
  db.query("DELETE FROM memories WHERE namespace = ?").run(namespace);
  namespace = "";
});

describe("api compatibility", () => {
  test("service add/get/update/traverse/updateKey flow remains compatible", async () => {
    namespace = makeNamespace();
    const service = new KVMemoryService();

    await service.addMemory(namespace, "base", {
      domain: "test",
      summary: "base-summary",
      text: "base-text",
      type: "decision",
      keywords: ["base"],
      links: [],
    });

    const fetched = await service.getMemory(namespace, "base");
    expect(fetched).toBeDefined();
    expect(fetched?.summary).toBe("base-summary");
    expect(fetched?.text).toBe("base-text");

    await service.updateMemory(namespace, "base", {
      summary: "updated-summary",
    });

    const updated = await service.getMemory(namespace, "base");
    expect(updated?.summary).toBe("updated-summary");
    expect(updated?.text).toBe("base-text");

    const traversed = await service.traverseMemory(namespace, "base");
    expect(traversed).toBeDefined();
    expect((traversed?.meta.traverse_count ?? 0) >= 1).toBe(true);

    await service.updateKey(namespace, "base", "renamed");

    const oldValue = await service.getMemory(namespace, "base");
    const renamed = await service.getMemory(namespace, "renamed");
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
