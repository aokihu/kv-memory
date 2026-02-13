/**
 * Bulk memory read service tests.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { getDatabase, initDatabase } from "../src/libs/kv/db";
import { KVMemory } from "../src/libs/kv";
import { KVMemoryService } from "../src/service";

const database = initDatabase(getDatabase());
let currentPrefix = "";

function makePrefix(): string {
  return `bulk_service_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function cleanup(prefix: string): void {
  if (!prefix) {
    return;
  }

  database.query("DELETE FROM memory_links WHERE from_key LIKE ? OR to_key LIKE ?").run(`${prefix}%`, `${prefix}%`);
  database.query("DELETE FROM memories WHERE key LIKE ?").run(`${prefix}%`);
}

afterEach(() => {
  cleanup(currentPrefix);
  currentPrefix = "";
});

async function setScore(kv: KVMemory, key: string, score: number): Promise<void> {
  const memory = await kv.get(key);
  if (!memory) {
    throw new Error(`memory not found: ${key}`);
  }

  await kv.setMeta(key, {
    ...memory.meta,
    score,
  });
}

describe("KVMemoryService bulkReadMemory", () => {
  test("applies DFS traversal, combined-score ordering and dedupe", async () => {
    currentPrefix = makePrefix();
    const kv = new KVMemory();
    const service = new KVMemoryService({ kv });

    const root = `${currentPrefix}_root`;
    const a = `${currentPrefix}_a`;
    const b = `${currentPrefix}_b`;
    const c = `${currentPrefix}_c`;
    const d = `${currentPrefix}_d`;
    const shared = `${currentPrefix}_shared`;
    const e = `${currentPrefix}_e`;

    await kv.add(d, { summary: "d", text: "d" });
    await kv.add(shared, { summary: "shared", text: "shared" });
    await kv.add(e, { summary: "e", text: "e" });
    await kv.add(a, { summary: "a", text: "a" }, [
      { type: "design", key: d, term: "a-d", weight: 0.9 },
      { type: "design", key: shared, term: "a-shared", weight: 0.4 },
    ]);
    await kv.add(b, { summary: "b", text: "b" }, [
      { type: "assumption", key: shared, term: "b-shared", weight: 0.9 },
      { type: "assumption", key: e, term: "b-e", weight: 0.8 },
    ]);
    await kv.add(c, { summary: "c", text: "c" });
    await kv.add(root, { summary: "root", text: "root" }, [
      { type: "decision", key: a, term: "root-a", weight: 0.6 },
      { type: "decision", key: b, term: "root-b", weight: 0.9 },
      { type: "decision", key: c, term: "root-c", weight: 0.2 },
    ]);

    await setScore(kv, a, 90);
    await setScore(kv, b, 30);
    await setScore(kv, c, 100);
    await setScore(kv, d, 80);
    await setScore(kv, shared, 90);
    await setScore(kv, e, 20);

    const result = await service.bulkReadMemory(root, {
      depth: 2,
      breadth: 2,
      total: 10,
    });

    expect(result).toBeDefined();
    if (!result) {
      return;
    }

    expect(result.associatedMemories.map((item) => item.key)).toEqual([a, d, shared, b, e]);
    expect(result.metadata.depthReached).toBe(2);
    expect(result.metadata.totalRetrieved).toBe(6);
    expect(result.metadata.duplicatesSkipped).toBeGreaterThanOrEqual(1);

    const sharedCount = result.associatedMemories.filter((item) => item.key === shared).length;
    expect(sharedCount).toBe(1);
  });

  test("stops immediately when total limit is reached", async () => {
    currentPrefix = makePrefix();
    const kv = new KVMemory();
    const service = new KVMemoryService({ kv });

    const root = `${currentPrefix}_root`;
    const a = `${currentPrefix}_a`;
    const b = `${currentPrefix}_b`;

    await kv.add(a, { summary: "a", text: "a" });
    await kv.add(b, { summary: "b", text: "b" });
    await kv.add(root, { summary: "root", text: "root" }, [
      { type: "decision", key: a, term: "root-a", weight: 0.8 },
      { type: "decision", key: b, term: "root-b", weight: 0.7 },
    ]);

    const result = await service.bulkReadMemory(root, {
      depth: 3,
      breadth: 5,
      total: 2,
    });

    expect(result).toBeDefined();
    if (!result) {
      return;
    }

    expect(result.associatedMemories).toHaveLength(1);
    expect(result.metadata.totalRetrieved).toBe(2);
  });

  test("handles cyclic links without infinite traversal", async () => {
    currentPrefix = makePrefix();
    const kv = new KVMemory();
    const service = new KVMemoryService({ kv });

    const root = `${currentPrefix}_root`;
    const a = `${currentPrefix}_a`;

    await kv.add(root, { summary: "root", text: "root" });
    await kv.add(a, { summary: "a", text: "a" }, [
      { type: "design", key: root, term: "a-root", weight: 0.9 },
    ]);
    await kv.update(root, { summary: "root", text: "root" }, [
      { type: "decision", key: a, term: "root-a", weight: 0.9 },
    ]);

    const result = await service.bulkReadMemory(root, {
      depth: 6,
      breadth: 20,
      total: 50,
    });

    expect(result).toBeDefined();
    if (!result) {
      return;
    }

    expect(result.associatedMemories.map((item) => item.key)).toEqual([a]);
    expect(result.metadata.duplicatesSkipped).toBeGreaterThanOrEqual(1);
  });
});
