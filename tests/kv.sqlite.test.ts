import { afterEach, describe, expect, test } from "bun:test";
import { getDatabase, initDatabase } from "../src/libs/db";
import { KVMemory } from "../src/libs/kv";
import type { MemoryMeta } from "../src/type";

const database = initDatabase(getDatabase());

let currentNamespace = "";

function makeNamespace(): string {
  return `ns_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanupNamespace(namespace: string): void {
  if (!namespace) {
    return;
  }

  database.query(`DELETE FROM memory_links WHERE namespace = ?`).run(namespace);
  database.query(`DELETE FROM memories WHERE namespace = ?`).run(namespace);
}

afterEach(() => {
  cleanupNamespace(currentNamespace);
  currentNamespace = "";
});

describe("KVMemory sqlite", () => {
  test("add/get stores columns and syncs links to relation table", async () => {
    currentNamespace = makeNamespace();
    const kv = new KVMemory(currentNamespace);

    await kv.add("target_1", {
      domain: "test",
      summary: "target summary",
      text: "target text",
      type: "design",
      keywords: ["target"],
      links: [],
    });

    await kv.add("source_1", {
      domain: "test",
      summary: "source summary",
      text: "source text",
      type: "decision",
      keywords: ["source"],
      links: [
        {
          type: "decision",
          key: "target_1",
          term: "points to target",
          weight: 0.8,
        },
        {
          type: "design",
          term: "no key link",
          weight: 0.2,
        },
      ],
    });

    const memory = await kv.get("source_1");
    expect(memory?.summary).toBe("source summary");
    expect(memory?.meta.id).toBe("source_1");
    expect(memory?.links.length).toBe(2);

    const linkRows = database
      .query(
        `SELECT from_key, to_key, link_type FROM memory_links WHERE namespace = ? AND from_key = ? ORDER BY id`,
      )
      .all(currentNamespace, "source_1") as Array<{ from_key: string; to_key: string; link_type: string }>;

    expect(linkRows.length).toBe(1);
    expect(linkRows[0]?.to_key).toBe("target_1");
    expect(linkRows[0]?.link_type).toBe("decision");
  });

  test("update supports partial fields and refreshes relation rows", async () => {
    currentNamespace = makeNamespace();
    const kv = new KVMemory(currentNamespace);

    await kv.add("target_a", {
      domain: "test",
      summary: "target a",
      text: "a",
      type: "design",
      keywords: [],
      links: [],
    });

    await kv.add("target_b", {
      domain: "test",
      summary: "target b",
      text: "b",
      type: "design",
      keywords: [],
      links: [],
    });

    await kv.add("source", {
      domain: "test",
      summary: "before",
      text: "keep-text",
      type: "decision",
      keywords: ["k1"],
      links: [{ type: "decision", key: "target_a", term: "a", weight: 0.5 }],
    });

    await kv.update("source", {
      summary: "after",
      links: [{ type: "decision", key: "target_b", term: "b", weight: 0.7 }],
    });

    const memory = await kv.get("source");
    expect(memory?.summary).toBe("after");
    expect(memory?.text).toBe("keep-text");

    const linkRows = database
      .query(`SELECT to_key FROM memory_links WHERE namespace = ? AND from_key = ? ORDER BY id`)
      .all(currentNamespace, "source") as Array<{ to_key: string }>;

    expect(linkRows.length).toBe(1);
    expect(linkRows[0]?.to_key).toBe("target_b");
  });

  test("setMeta updates meta JSON and created_at column", async () => {
    currentNamespace = makeNamespace();
    const kv = new KVMemory(currentNamespace);

    await kv.add("meta_key", {
      domain: "test",
      summary: "summary",
      text: "text",
      type: "decision",
      keywords: [],
      links: [],
    });

    const current = await kv.get("meta_key");
    if (!current) {
      throw new Error("test setup failed: memory not found");
    }

    const nextMeta: MemoryMeta = {
      ...current.meta,
      access_count: current.meta.access_count + 10,
      created_at: current.meta.created_at + 1,
    };

    await kv.setMeta("meta_key", nextMeta);

    const updated = await kv.get("meta_key");
    expect(updated?.meta.access_count).toBe(nextMeta.access_count);
    expect(updated?.meta.created_at).toBe(nextMeta.created_at);

    const createdAtRow = database
      .query(`SELECT created_at FROM memories WHERE namespace = ? AND key = ?`)
      .get(currentNamespace, "meta_key") as { created_at: number } | null;

    expect(createdAtRow?.created_at).toBe(nextMeta.created_at);
  });

  test("updateKey migrates key and keeps link relation synchronized", async () => {
    currentNamespace = makeNamespace();
    const kv = new KVMemory(currentNamespace);

    await kv.add("target", {
      domain: "test",
      summary: "target",
      text: "target",
      type: "design",
      keywords: [],
      links: [],
    });

    await kv.add("old_key", {
      domain: "test",
      summary: "old",
      text: "old",
      type: "decision",
      keywords: [],
      links: [{ type: "decision", key: "target", term: "to target", weight: 0.5 }],
    });

    await kv.add("inbound", {
      domain: "test",
      summary: "inbound",
      text: "inbound",
      type: "assumption",
      keywords: [],
      links: [{ type: "assumption", key: "old_key", term: "to old key", weight: 0.6 }],
    });

    await kv.updateKey("old_key", "new_key");

    const oldMemory = await kv.get("old_key");
    const newMemory = await kv.get("new_key");
    expect(oldMemory).toBeUndefined();
    expect(newMemory?.meta.id).toBe("new_key");

    const outgoing = database
      .query(`SELECT to_key FROM memory_links WHERE namespace = ? AND from_key = ?`)
      .all(currentNamespace, "new_key") as Array<{ to_key: string }>;
    expect(outgoing.length).toBe(1);
    expect(outgoing[0]?.to_key).toBe("target");

    const incoming = database
      .query(`SELECT from_key, to_key FROM memory_links WHERE namespace = ? AND from_key = ?`)
      .all(currentNamespace, "inbound") as Array<{ from_key: string; to_key: string }>;
    expect(incoming.length).toBe(1);
    expect(incoming[0]?.to_key).toBe("new_key");
  });

  test("updateKey failure rolls back transaction", async () => {
    currentNamespace = makeNamespace();
    const kv = new KVMemory(currentNamespace);

    await kv.add("old_key", {
      domain: "test",
      summary: "old",
      text: "old",
      type: "decision",
      keywords: [],
      links: [],
    });

    await kv.add("existing_key", {
      domain: "test",
      summary: "existing",
      text: "existing",
      type: "design",
      keywords: [],
      links: [],
    });

    await expect(kv.updateKey("old_key", "existing_key")).rejects.toThrow();

    const oldMemory = await kv.get("old_key");
    const existingMemory = await kv.get("existing_key");
    expect(oldMemory?.meta.id).toBe("old_key");
    expect(existingMemory?.meta.id).toBe("existing_key");
  });
});
