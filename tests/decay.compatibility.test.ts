/**
 * Backward compatibility tests for memory decay changes.
 *
 * Debug entry: start from `createLegacyMemoryRow()` when a legacy-data case fails.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { addMemoryController } from "../src/controller/addMemory";
import { getMemoryController } from "../src/controller/getMemory";
import { getMemoryStatsHandler } from "../src/controller/memoryStats";
import { updateMemoryController } from "../src/controller/updateMemory";
import { updateMemoryKeyController } from "../src/controller/updateMemoryKey";
import {
  MemoryMetaSchema,
  MemorySchema,
  MemoryStatusEnums,
  type AppServerContext,
  type Memory,
} from "../src/type";

const TEST_SESSION_ID = "compat-session";
const TEST_NAMESPACE = "CompatNs";
const COMPAT_DB_FILE = "/tmp/kvdb-compatibility.sqlite";

let caseIndex = 0;

type KVMemoryInstance = {
  add: (key: string, arg: { summary: string; text: string }) => Promise<void>;
  get: (key: string) => Promise<Memory | undefined>;
  setMeta: (key: string, meta: Memory["meta"]) => Promise<void>;
  update: (key: string, arg: Partial<{ summary: string; text: string }>) => Promise<void>;
};

/**
 * Build a unique key per test case to keep reruns isolated.
 */
function nextKey(prefix: string): string {
  caseIndex += 1;
  return `${prefix}-${Date.now()}-${caseIndex}`;
}

/**
 * Create JSON request payload for controller compatibility checks.
 */
function createJsonRequest(url: string, payload: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

/**
 * Parse controller response and assert HTTP status at one place.
 */
async function readJsonResponse(response: Response, expectedStatus?: number): Promise<unknown> {
  if (typeof expectedStatus === "number") {
    expect(response.status).toBe(expectedStatus);
  }

  return await response.json();
}

/**
 * Insert an old-format memory row (without score/version) into DB.
 *
 * Debug hint: if this insert fails, inspect table migration state in `memories` schema.
 */
function createLegacyMemoryRow(kv: KVMemoryInstance, key: string): void {
  const db = (kv as unknown as { _database: { query: (sql: string) => { run: (...args: unknown[]) => void } } })._database;
  const now = Date.now();

  const legacyMeta = {
    id: key,
    created_at: now,
    last_accessed_at: now,
    last_linked_at: now,
    in_degree: 0,
    out_degree: 0,
    access_count: 0,
    traverse_count: 0,
    status: "active",
  };

  db.query(
    `INSERT OR REPLACE INTO memories (key, summary, text, meta, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(key, "legacy summary", "legacy text", JSON.stringify(legacyMeta), now);
}

/**
 * Create KVMemory after pinning a writable sqlite file path.
 *
 * Debug hint: if DB bootstrap fails, inspect COMPAT_DB_FILE permission and path.
 */
async function createKVMemory(): Promise<KVMemoryInstance> {
  process.env.KVDB_SQLITE_FILE = COMPAT_DB_FILE;
  const { KVMemory } = await import("../src/libs/kv/kv");
  return new KVMemory() as unknown as KVMemoryInstance;
}

/**
 * Build a legacy-compatible controller context with session + memory service mocks.
 */
function createControllerContext(overrides: Partial<AppServerContext>): AppServerContext {
  return {
    sessionService: {
      getSession: async () => ({
        kv_namespace: TEST_NAMESPACE,
        last_memory_key: "",
      }),
      setSession: async () => undefined,
    } as unknown as AppServerContext["sessionService"],
    kvMemoryService: {
      addMemory: async () => undefined,
      getMemory: async () => undefined,
      updateMemory: async () => undefined,
      updateKey: async () => undefined,
      traverseMemory: async () => undefined,
    } as unknown as AppServerContext["kvMemoryService"],
    ...overrides,
  };
}

beforeEach(() => {
  caseIndex = 0;
});

describe("MEM-DECAY-051 backward compatibility", () => {
  it("keeps database schema/data compatible with legacy rows", async () => {
    const kv = await createKVMemory();
    const key = nextKey("legacy-schema");

    createLegacyMemoryRow(kv, key);

    const loaded = await kv.get(key);
    expect(loaded).toBeDefined();
    expect(loaded?.summary).toBe("legacy summary");
    expect(loaded?.text).toBe("legacy text");
    expect(loaded?.meta.score).toBe(50);
    expect(loaded?.meta.status).toBe("active");
  });

  it("keeps API interface compatible for existing client payloads", async () => {
    const createdMemory: Memory = {
      summary: "stored",
      text: "stored",
      meta: {
        id: "k",
        created_at: Date.now(),
        last_accessed_at: Date.now(),
        last_linked_at: Date.now(),
        in_degree: 0,
        out_degree: 0,
        access_count: 0,
        traverse_count: 0,
        score: 50,
        status: "active",
      },
    };

    const context = createControllerContext({
      kvMemoryService: {
        addMemory: async () => undefined,
        getMemory: async (_ns: string, key: string) => {
          if (key === "k") {
            return createdMemory;
          }

          return undefined;
        },
        updateMemory: async () => undefined,
        updateKey: async () => undefined,
        traverseMemory: async () => undefined,
      } as unknown as AppServerContext["kvMemoryService"],
    });

    const addResponse = (await addMemoryController(
      createJsonRequest("http://compat/add_memory", {
        session: TEST_SESSION_ID,
        key: "k",
        value: { summary: "s", text: "t" },
      }) as Bun.BunRequest<"/add_memory">,
      context,
    )) as Response;
    expect(await readJsonResponse(addResponse, 200)).toEqual({ success: true });

    const getResponse = (await getMemoryController(
      createJsonRequest("http://compat/get_memory", {
        session: TEST_SESSION_ID,
        key: "k",
      }) as Bun.BunRequest<"/get_memory">,
      context,
    )) as Response;
    const getPayload = (await readJsonResponse(getResponse, 200)) as {
      success: boolean;
      data: Memory;
    };
    expect(getPayload.success).toBe(true);
    expect(getPayload.data.meta.score).toBe(50);

    const updateResponse = (await updateMemoryController(
      createJsonRequest("http://compat/update_memory", {
        session: TEST_SESSION_ID,
        key: "k",
        value: { summary: "updated" },
      }) as Bun.BunRequest<"/update_memory">,
      context,
    )) as Response;
    const updatePayload = (await readJsonResponse(updateResponse, 200)) as {
      success: boolean;
      data: { key: string };
    };
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.data.key).toBe("k");

    const renameResponse = (await updateMemoryKeyController(
      createJsonRequest("http://compat/update_memory_key", {
        session: TEST_SESSION_ID,
        old_key: "k",
        new_key: "k2",
      }) as Bun.BunRequest<"/update_memory_key">,
      context,
    )) as Response;
    const renamePayload = (await readJsonResponse(renameResponse, 200)) as {
      success: boolean;
      data: { old_key: string; new_key: string };
    };
    expect(renamePayload.success).toBe(true);
    expect(renamePayload.data.old_key).toBe("k");
    expect(renamePayload.data.new_key).toBe("k2");
  });

  it("keeps existing statistics endpoint query configuration compatible", async () => {
    const kv = await createKVMemory();
    const key = nextKey("legacy-config");

    await kv.add(key, {
      summary: "for stats",
      text: "for stats",
    });

    const context = {
      req: {
        url: "http://compat/api/memories/stats?fromTimestamp=1&toTimestamp=9999999999999&histogramBinSize=10&cacheTtlMs=1000&exportFormat=json",
      },
      json: (payload: unknown, status?: number) => ({ payload, status }),
      get: (name: string) => {
        if (name === "services") {
          return {
            kvMemoryService: {
              db: (kv as unknown as { _database: unknown })._database,
            },
          };
        }

        return undefined;
      },
    };

    const result = (await getMemoryStatsHandler(context)) as {
      status: number;
      payload: { ok: boolean; data: { counts: { total: number } } };
    };
    expect(result.status).toBe(200);
    expect(result.payload.ok).toBe(true);
    expect(result.payload.data.counts.total).toBeGreaterThanOrEqual(1);
  });

  it("keeps data type compatibility for old meta definitions", () => {
    const now = Date.now();

    const legacyMeta = {
      id: "legacy-meta",
      created_at: now,
      last_accessed_at: now,
      last_linked_at: now,
      in_degree: 0,
      out_degree: 0,
      access_count: 0,
      traverse_count: 0,
      status: "active",
    };

    const parsedMeta = MemoryMetaSchema.parse(legacyMeta);
    expect(parsedMeta.score).toBe(50);
    expect(parsedMeta.version).toBeUndefined();

    const parsedMemory = MemorySchema.parse({
      summary: "legacy",
      text: "legacy",
      meta: legacyMeta,
    });
    expect(parsedMemory.meta.score).toBe(50);

    expect(MemoryStatusEnums.parse("active")).toBe("active");
    expect(MemoryStatusEnums.parse("cold")).toBe("cold");
    expect(MemoryStatusEnums.parse("deprecated")).toBe("deprecated");
    expect(MemoryStatusEnums.parse("deleted")).toBe("deleted");
    expect(() => MemoryStatusEnums.parse("unknown")).toThrow();
  });

  it("keeps behavior compatibility when updating legacy-shaped meta", async () => {
    const kv = await createKVMemory();
    const key = nextKey("legacy-behavior");

    await kv.add(key, {
      summary: "before",
      text: "before",
    });

    const memory = await kv.get(key);
    expect(memory).toBeDefined();

    const legacyShapedMeta = {
      ...memory!.meta,
      score: undefined,
    };

    await kv.setMeta(key, legacyShapedMeta);
    await kv.update(key, { summary: "after" });

    const updated = await kv.get(key);
    expect(updated?.summary).toBe("after");
    expect(updated?.meta.score).toBe(50);
  });

  it("keeps error message compatibility for existing failure paths", async () => {
    const invalidSessionContext = createControllerContext({
      sessionService: {
        getSession: async () => undefined,
        setSession: async () => undefined,
      } as unknown as AppServerContext["sessionService"],
    });

    const addInvalidSession = (await addMemoryController(
      createJsonRequest("http://compat/add_memory", {
        session: TEST_SESSION_ID,
        key: "missing-session",
        value: { summary: "s", text: "t" },
      }) as Bun.BunRequest<"/add_memory">,
      invalidSessionContext,
    )) as Response;
    expect(await readJsonResponse(addInvalidSession, 400)).toEqual({
      success: false,
      message: "invalid session",
    });

    const getInvalidJson = (await getMemoryController(
      new Request("http://compat/get_memory", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }) as Bun.BunRequest<"/get_memory">,
      createControllerContext({}),
    )) as Response;
    expect(await readJsonResponse(getInvalidJson, 400)).toEqual({
      success: false,
      message: "invalid json",
    });

    const missingMemoryContext = createControllerContext({
      kvMemoryService: {
        addMemory: async () => undefined,
        getMemory: async () => undefined,
        updateMemory: async () => undefined,
        updateKey: async () => undefined,
        traverseMemory: async () => undefined,
      } as unknown as AppServerContext["kvMemoryService"],
    });

    const updateMissing = (await updateMemoryController(
      createJsonRequest("http://compat/update_memory", {
        session: TEST_SESSION_ID,
        key: "missing-memory",
        value: { summary: "x" },
      }) as Bun.BunRequest<"/update_memory">,
      missingMemoryContext,
    )) as Response;
    expect(await readJsonResponse(updateMissing)).toEqual({
      success: false,
      message: "memory not found",
    });
  });

  it("supports smooth upgrade path from legacy record to updated record", async () => {
    const kv = await createKVMemory();
    const key = nextKey("legacy-upgrade");

    createLegacyMemoryRow(kv, key);

    const before = await kv.get(key);
    expect(before?.meta.score).toBe(50);

    await kv.update(key, {
      summary: "after-upgrade",
      text: "after-upgrade",
    });

    const after = await kv.get(key);
    expect(after?.summary).toBe("after-upgrade");
    expect(after?.text).toBe("after-upgrade");
    expect(after?.meta.status).toBe("active");
    expect(after?.meta.score).toBe(50);
  });
});
