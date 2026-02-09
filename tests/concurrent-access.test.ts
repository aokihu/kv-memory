/**
 * Concurrent access tests for SQLite-backed KV memory.
 *
 * Goal: validate data consistency under parallel operations and multi-instance access.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase, getDatabase } from "../src/libs/db";
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
  db.query("DELETE FROM memory_links WHERE namespace = ?").run(namespace);
  db.query("DELETE FROM memories WHERE namespace = ?").run(namespace);
  namespace = "";
});

describe("concurrent access", () => {
  test("parallel add/get across same namespace remains consistent", async () => {
    namespace = makeNamespace();
    const kv = new KVMemory(namespace);
    const total = 120;

    await Promise.all(
      Array.from({ length: total }, async (_, index) => {
        await kv.add(`k_${index}`, {
          domain: "concurrent",
          summary: `summary-${index}`,
          text: `text-${index}`,
          type: "decision",
          keywords: ["concurrent"],
          links: [],
        });
      }),
    );

    const values = await Promise.all(
      Array.from({ length: total }, async (_, index) => {
        return await kv.get(`k_${index}`);
      }),
    );

    expect(values.filter(Boolean).length).toBe(total);
  });

  test("parallel updates on same key keep valid memory object", async () => {
    namespace = makeNamespace();
    const kv = new KVMemory(namespace);

    await kv.add("shared", {
      domain: "concurrent",
      summary: "initial",
      text: "initial-text",
      type: "design",
      keywords: ["shared"],
      links: [],
    });

    await Promise.all(
      Array.from({ length: 40 }, async (_, index) => {
        await kv.update("shared", {
          summary: `summary-${index}`,
        });
      }),
    );

    const latest = await kv.get("shared");
    expect(latest).toBeDefined();
    expect(latest?.summary.startsWith("summary-")).toBe(true);
    expect(latest?.text).toBe("initial-text");
  });

  test("multiple instances concurrently writing same namespace remain readable", async () => {
    namespace = makeNamespace();
    const instances = [new KVMemory(namespace), new KVMemory(namespace), new KVMemory(namespace)];
    const total = 90;

    await Promise.all(
      Array.from({ length: total }, async (_, index) => {
        const instance = instances[index % instances.length] as KVMemory;
        await instance.add(`multi_${index}`, {
          domain: "concurrent",
          summary: `multi-summary-${index}`,
          text: `multi-text-${index}`,
          type: "assumption",
          keywords: ["multi"],
          links: [],
        });
      }),
    );

    const reader = new KVMemory(namespace);
    const rows = await Promise.all(
      Array.from({ length: total }, async (_, index) => {
        return await reader.get(`multi_${index}`);
      }),
    );

    expect(rows.filter(Boolean).length).toBe(total);
  });
});
