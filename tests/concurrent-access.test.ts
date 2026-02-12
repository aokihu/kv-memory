/**
 * Concurrent access tests for SQLite-backed KV memory.
 *
 * Goal: validate data consistency under parallel operations and multi-instance access.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase, getDatabase } from "../src/libs/kv/db";
import { KVMemory } from "../src/libs/kv";

const db = initDatabase(getDatabase());

let namespace = "";

function makeNamespace(): string {
  return `concurrent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

afterEach(() => {
  if (!namespace) {
    return;
  }
  db.query("DELETE FROM memory_links WHERE from_key LIKE ? OR to_key LIKE ?").run(`${namespace}_%`, `${namespace}_%`);
  db.query("DELETE FROM memories WHERE key LIKE ?").run(`${namespace}_%`);
  namespace = "";
});

describe("concurrent access", () => {
  test("parallel add/get across same namespace remains consistent", async () => {
    namespace = makeNamespace();
    const kv = new KVMemory();
    const total = 120;

    await Promise.all(
      Array.from({ length: total }, async (_, index) => {
        await kv.add(`${namespace}_k_${index}`, {
          summary: `summary-${index}`,
          text: `text-${index}`,
        });
      }),
    );

    const values = await Promise.all(
      Array.from({ length: total }, async (_, index) => {
        return await kv.get(`${namespace}_k_${index}`);
      }),
    );

    expect(values.filter(Boolean).length).toBe(total);
  });

  test("parallel updates on same key keep valid memory object", async () => {
    namespace = makeNamespace();
    const kv = new KVMemory();

    const sharedKey = `${namespace}_shared`;

    await kv.add(sharedKey, {
      summary: "initial",
      text: "initial-text",
    });

    await Promise.all(
      Array.from({ length: 40 }, async (_, index) => {
        await kv.update(sharedKey, {
          summary: `summary-${index}`,
        });
      }),
    );

    const latest = await kv.get(sharedKey);
    expect(latest).toBeDefined();
    expect(latest?.summary.startsWith("summary-")).toBe(true);
    expect(latest?.text).toBe("initial-text");
  });

  test("multiple instances concurrently writing same namespace remain readable", async () => {
    namespace = makeNamespace();
    const instances = [new KVMemory(), new KVMemory(), new KVMemory()];
    const total = 90;

    await Promise.all(
      Array.from({ length: total }, async (_, index) => {
        const instance = instances[index % instances.length] as KVMemory;
        await instance.add(`${namespace}_multi_${index}`, {
          summary: `multi-summary-${index}`,
          text: `multi-text-${index}`,
        });
      }),
    );

    const reader = new KVMemory();
    const rows = await Promise.all(
      Array.from({ length: total }, async (_, index) => {
        return await reader.get(`${namespace}_multi_${index}`);
      }),
    );

    expect(rows.filter(Boolean).length).toBe(total);
  });
});
