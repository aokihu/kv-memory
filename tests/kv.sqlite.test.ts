import { afterEach, describe, expect, test } from "bun:test";
import { getDatabase, initDatabase } from "../src/libs/kv/db";
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

  database.query(`DELETE FROM memory_links WHERE from_key LIKE ? OR to_key LIKE ?`).run(`${namespace}_%`, `${namespace}_%`);
  database.query(`DELETE FROM memories WHERE key LIKE ?`).run(`${namespace}_%`);
}

afterEach(() => {
  cleanupNamespace(currentNamespace);
  currentNamespace = "";
});

describe("KVMemory sqlite", () => {
  test("add/get stores columns and syncs links to relation table", async () => {
    currentNamespace = makeNamespace();
    const kv = new KVMemory();
    const targetKey = `${currentNamespace}_target_1`;
    const sourceKey = `${currentNamespace}_source_1`;

    await kv.add(targetKey, {
      summary: "target summary",
      text: "target text",
    });

    await kv.add(sourceKey, {
      summary: "source summary",
      text: "source text",
    }, [
      {
        type: "decision",
        key: targetKey,
        term: "points to target",
        weight: 0.8,
      },
      {
        type: "design",
        term: "no key link",
        weight: 0.2,
      },
    ]);

    const memory = await kv.get(sourceKey);
    expect(memory?.summary).toBe("source summary");
    expect(memory?.meta.id).toBe(sourceKey);

    const links = await kv.getLinks(sourceKey);
    expect(links.length).toBe(1);

    const linkRows = database
      .query(
        `SELECT from_key, to_key, link_type FROM memory_links WHERE from_key = ? ORDER BY id`,
      )
      .all(sourceKey) as Array<{ from_key: string; to_key: string; link_type: string }>;

    expect(linkRows.length).toBe(1);
    expect(linkRows[0]?.to_key).toBe(targetKey);
    expect(linkRows[0]?.link_type).toBe("decision");
  });

  test("update supports partial fields and refreshes relation rows", async () => {
    currentNamespace = makeNamespace();
    const kv = new KVMemory();
    const targetAKey = `${currentNamespace}_target_a`;
    const targetBKey = `${currentNamespace}_target_b`;
    const sourceKey = `${currentNamespace}_source`;

    await kv.add(targetAKey, {
      summary: "target a",
      text: "a",
    });

    await kv.add(targetBKey, {
      summary: "target b",
      text: "b",
    });

    await kv.add(sourceKey, {
      summary: "before",
      text: "keep-text",
    }, [{ type: "decision", key: targetAKey, term: "a", weight: 0.5 }]);

    await kv.update(sourceKey, {
      summary: "after",
    }, [{ type: "decision", key: targetBKey, term: "b", weight: 0.7 }]);

    const memory = await kv.get(sourceKey);
    expect(memory?.summary).toBe("after");
    expect(memory?.text).toBe("keep-text");

    const linkRows = database
      .query(`SELECT to_key FROM memory_links WHERE from_key = ? ORDER BY id`)
      .all(sourceKey) as Array<{ to_key: string }>;

    expect(linkRows.length).toBe(1);
    expect(linkRows[0]?.to_key).toBe(targetBKey);
  });

  test("setMeta updates meta JSON and created_at column", async () => {
    currentNamespace = makeNamespace();
    const kv = new KVMemory();
    const key = `${currentNamespace}_meta_key`;

    await kv.add(key, {
      summary: "summary",
      text: "text",
    });

    const current = await kv.get(key);
    if (!current) {
      throw new Error("test setup failed: memory not found");
    }

    const nextMeta: MemoryMeta = {
      ...current.meta,
      access_count: current.meta.access_count + 10,
      created_at: current.meta.created_at + 1,
    };

    await kv.setMeta(key, nextMeta);

    const updated = await kv.get(key);
    expect(updated?.meta.access_count).toBe(nextMeta.access_count);
    expect(updated?.meta.created_at).toBe(nextMeta.created_at);

    const createdAtRow = database
      .query(`SELECT created_at FROM memories WHERE key = ?`)
      .get(key) as { created_at: number } | null;

    expect(createdAtRow?.created_at).toBe(nextMeta.created_at);
  });

  test("updateKey migrates key and keeps link relation synchronized", async () => {
    currentNamespace = makeNamespace();
    const kv = new KVMemory();
    const targetKey = `${currentNamespace}_target`;
    const oldKey = `${currentNamespace}_old_key`;
    const newKey = `${currentNamespace}_new_key`;
    const inboundKey = `${currentNamespace}_inbound`;

    await kv.add(targetKey, {
      summary: "target",
      text: "target",
    });

    await kv.add(oldKey, {
      summary: "old",
      text: "old",
    }, [{ type: "decision", key: targetKey, term: "to target", weight: 0.5 }]);

    await kv.add(inboundKey, {
      summary: "inbound",
      text: "inbound",
    }, [{ type: "assumption", key: oldKey, term: "to old key", weight: 0.6 }]);

    await kv.updateKey(oldKey, newKey);

    const oldMemory = await kv.get(oldKey);
    const newMemory = await kv.get(newKey);
    expect(oldMemory).toBeUndefined();
    expect(newMemory?.meta.id).toBe(newKey);

    const outgoing = database
      .query(`SELECT to_key FROM memory_links WHERE from_key = ?`)
      .all(newKey) as Array<{ to_key: string }>;
    expect(outgoing.length).toBe(1);
    expect(outgoing[0]?.to_key).toBe(targetKey);

    const incoming = database
      .query(`SELECT from_key, to_key FROM memory_links WHERE from_key = ?`)
      .all(inboundKey) as Array<{ from_key: string; to_key: string }>;
    expect(incoming.length).toBe(1);
    expect(incoming[0]?.to_key).toBe(newKey);
  });

  test("updateKey failure rolls back transaction", async () => {
    currentNamespace = makeNamespace();
    const kv = new KVMemory();
    const oldKey = `${currentNamespace}_old_key`;
    const existingKey = `${currentNamespace}_existing_key`;

    await kv.add(oldKey, {
      summary: "old",
      text: "old",
    });

    await kv.add(existingKey, {
      summary: "existing",
      text: "existing",
    });

    await expect(kv.updateKey(oldKey, existingKey)).rejects.toThrow();

    const oldMemory = await kv.get(oldKey);
    const existingMemory = await kv.get(existingKey);
    expect(oldMemory?.meta.id).toBe(oldKey);
    expect(existingMemory?.meta.id).toBe(existingKey);
  });
});
