/**
 * Final deployment verification test suite.
 *
 * Coverage focus:
 * 1) service-level core workflow
 */

import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase, getDatabase } from "../src/libs/kv/db";
import { KVMemoryService } from "../src/service";

const runtimeDb = initDatabase(getDatabase());

let namespace = "";

function makeNamespace(): string {
  return `final_verify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

    await service.addMemory(keyA, {
      summary: "A",
      text: "A text",
    });

    await service.addMemory(keyB, {
      summary: "B",
      text: "B text",
    });

    const fetched = await service.getMemory(keyB);
    expect(fetched?.summary).toBe("B");
    expect(fetched?.links.length).toBe(0);

    await service.updateMemory(keyB, { summary: "B2" });
    const updated = await service.getMemory(keyB);
    expect(updated?.summary).toBe("B2");

    const traversed = await service.traverseMemory(keyB);
    expect((traversed?.meta.traverse_count ?? 0) >= 1).toBe(true);

    await service.updateKey(keyB, renamedKey);
    expect(await service.getMemory(keyB)).toBeUndefined();
    expect((await service.getMemory(renamedKey))?.summary).toBe("B2");
  });
});
