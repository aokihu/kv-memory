/**
 * Bulk memory API integration tests.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { bulkMemoryReadController } from "../src/controller/bulkMemory";
import { getDatabase, initDatabase } from "../src/libs/kv/db";
import { KVMemoryService, SessionService } from "../src/service";
import type { AppServerContext } from "../src/type";

const database = initDatabase(getDatabase());
let activeServer: ReturnType<typeof Bun.serve> | null = null;
let currentPrefix = "";

function makePrefix(): string {
  return `bulk_api_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function cleanup(prefix: string): void {
  if (!prefix) {
    return;
  }

  database.query("DELETE FROM memory_links WHERE from_key LIKE ? OR to_key LIKE ?").run(`${prefix}%`, `${prefix}%`);
  database.query("DELETE FROM memories WHERE key LIKE ?").run(`${prefix}%`);
}

afterEach(() => {
  if (activeServer) {
    activeServer.stop(true);
    activeServer = null;
  }

  cleanup(currentPrefix);
  currentPrefix = "";
});

function createBulkServer(context: AppServerContext): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: 0,
    routes: {
      "/api/memories/:key/bulk": {
        GET: (req) => bulkMemoryReadController(req, context),
      },
    },
  });
}

describe("bulk memory api integration", () => {
  test("GET /api/memories/{key}/bulk returns structured payload", async () => {
    currentPrefix = makePrefix();
    const service = new KVMemoryService();
    const context: AppServerContext = {
      kvMemoryService: service,
      sessionService: new SessionService(),
    };

    const root = `${currentPrefix}_root`;
    const child = `${currentPrefix}_child`;
    await service.addMemory(child, { summary: "child", text: "child" });
    await service.addMemory(root, { summary: "root", text: "root" }, [
      { type: "decision", key: child, term: "root-child", weight: 0.9 },
    ]);

    activeServer = createBulkServer(context);
    const response = await fetch(`${activeServer.url}/api/memories/${encodeURIComponent(root)}/bulk`);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.targetMemory.key).toBe(root);
    expect(Array.isArray(payload.data.associatedMemories)).toBe(true);
    expect(payload.data.associatedMemories[0].key).toBe(child);
    expect(typeof payload.data.metadata.depthReached).toBe("number");
    expect(typeof payload.data.metadata.totalRetrieved).toBe("number");
    expect(typeof payload.data.metadata.duplicatesSkipped).toBe("number");
  });

  test("GET /api/memories/{key}/bulk validates depth breadth total ranges", async () => {
    currentPrefix = makePrefix();
    const context: AppServerContext = {
      kvMemoryService: new KVMemoryService(),
      sessionService: new SessionService(),
    };
    activeServer = createBulkServer(context);

    const response = await fetch(`${activeServer.url}/api/memories/any/bulk?depth=7&breadth=21&total=51`);

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.success).toBe(false);
    expect(Array.isArray(payload.message)).toBe(true);
  });

  test("GET /api/memories/{key}/bulk returns 404 when target does not exist", async () => {
    currentPrefix = makePrefix();
    const context: AppServerContext = {
      kvMemoryService: new KVMemoryService(),
      sessionService: new SessionService(),
    };
    activeServer = createBulkServer(context);

    const response = await fetch(`${activeServer.url}/api/memories/${currentPrefix}_missing/bulk`);

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.success).toBe(false);
    expect(payload.message).toBe("memory not found");
  });
});
