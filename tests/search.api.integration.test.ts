/**
 * Search API integration tests.
 *
 * Uses real HTTP requests against a Bun server that mounts
 * `GET /search` and `GET /fulltext` routes.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { SearchController } from "../src/controller/searchController";
import { initDatabase, getDatabase } from "../src/libs/kv/db";
import { KVMemoryService, SessionService } from "../src/service";
import type { SearchResult } from "../src/service";

const db = initDatabase(getDatabase());

let activeServer: ReturnType<typeof Bun.serve> | null = null;
const cleanupPrefixes = new Set<string>();

function createPrefix(): string {
  return `search_api_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createSearchServer(
  service: KVMemoryService,
  sessionService: SessionService = new SessionService(),
): ReturnType<typeof Bun.serve> {
  const searchController = new SearchController(service, sessionService);

  return Bun.serve({
    port: 0,
    routes: {
      "/search": {
        GET: (req) => searchController.search(req),
      },
      "/fulltext": {
        GET: (req) => searchController.fulltextSearch(req),
      },
    },
  });
}

async function seedSearchRecords(service: KVMemoryService, prefix: string): Promise<void> {
  await service.addMemory(`${prefix}_quantum`, {
    summary: "量子计算研究",
    text: "量子 比特 和 量子 计算 模型 用于全文搜索测试",
  });

  await service.addMemory(`${prefix}_sqlite`, {
    summary: "SQLite 搜索实现",
    text: "SQLite FTS5 支持全文索引与关键词匹配",
  });

  await service.addMemory(`${prefix}_unrelated`, {
    summary: "天气记录",
    text: "今天晴天，不包含目标搜索词",
  });
}

async function seedNamespaceSearchRecords(
  service: KVMemoryService,
  namespaceA: string,
  namespaceB: string,
  token: string,
): Promise<{ keyA: string; keyB: string }> {
  const keyA = `${namespaceA}:search_hit_a`;
  const keyB = `${namespaceB}:search_hit_b`;

  await service.addMemory(keyA, {
    summary: "namespace a record",
    text: `shared token ${token} appears in namespace A`,
  });

  await service.addMemory(keyB, {
    summary: "namespace b record",
    text: `shared token ${token} appears in namespace B`,
  });

  return { keyA, keyB };
}

function createDisabledSearchService(): KVMemoryService {
  const searchService = {
    async search(_query: string, limit = 10, offset = 0): Promise<SearchResult> {
      return {
        results: [],
        pagination: {
          total: 0,
          limit,
          offset,
        },
      };
    },
    async fulltextSearch(
      _keywords: string[],
      _operator: "AND" | "OR" = "OR",
      limit = 10,
      offset = 0,
    ): Promise<SearchResult> {
      return {
        results: [],
        pagination: {
          total: 0,
          limit,
          offset,
        },
      };
    },
  };

  return new KVMemoryService({ searchService: searchService as any });
}

function createFailingSearchService(message: string): KVMemoryService {
  const searchService = {
    async search(): Promise<SearchResult> {
      throw new Error(message);
    },
    async fulltextSearch(): Promise<SearchResult> {
      throw new Error(message);
    },
  };

  return new KVMemoryService({ searchService: searchService as any });
}

afterEach(() => {
  if (activeServer) {
    activeServer.stop(true);
    activeServer = null;
  }

  for (const prefix of cleanupPrefixes) {
    db.query("DELETE FROM memory_links WHERE from_key LIKE ? OR to_key LIKE ?").run(`${prefix}%`, `${prefix}%`);
    db.query("DELETE FROM memories WHERE key LIKE ?").run(`${prefix}%`);
  }

  cleanupPrefixes.clear();
});

describe("search api integration", () => {
  test("GET /search returns matched records with expected response shape", async () => {
    const prefix = createPrefix();
    cleanupPrefixes.add(prefix);

    const service = new KVMemoryService();
    await seedSearchRecords(service, prefix);
    activeServer = createSearchServer(service);

    const response = await fetch(`${activeServer.url}/search?q=量子`);
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(Array.isArray(payload.data.results)).toBe(true);
    expect(payload.data.pagination.total >= 1).toBe(true);
    expect(payload.data.pagination.limit).toBe(10);
    expect(payload.data.pagination.offset).toBe(0);

    const first = payload.data.results[0];
    expect(typeof first.key).toBe("string");
    expect(typeof first.summary).toBe("string");
    expect(typeof first.excerpt).toBe("string");
    expect(typeof first.relevance).toBe("number");
    expect(typeof first.score).toBe("number");
  });

  test("GET /search handles pagination parameters", async () => {
    const prefix = createPrefix();
    cleanupPrefixes.add(prefix);

    const service = new KVMemoryService();
    await seedSearchRecords(service, prefix);
    activeServer = createSearchServer(service);

    const response = await fetch(`${activeServer.url}/search?q=搜索&limit=1&offset=1`);
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.pagination.limit).toBe(1);
    expect(payload.data.pagination.offset).toBe(1);
    expect(payload.data.results.length <= 1).toBe(true);
  });

  test("GET /search returns 400 when parameters are invalid", async () => {
    const service = new KVMemoryService();
    activeServer = createSearchServer(service);

    const missingQuery = await fetch(`${activeServer.url}/search`);
    expect(missingQuery.status).toBe(400);
    const missingPayload = await missingQuery.json();
    expect(missingPayload.success).toBe(false);
    expect(Array.isArray(missingPayload.message)).toBe(true);

    const invalidPagination = await fetch(`${activeServer.url}/search?q=test&limit=0&offset=-1`);
    expect(invalidPagination.status).toBe(400);
    const invalidPayload = await invalidPagination.json();
    expect(invalidPayload.success).toBe(false);
    expect(Array.isArray(invalidPayload.message)).toBe(true);
  });

  test("GET /search with valid session filters records by namespace", async () => {
    const prefix = createPrefix();
    cleanupPrefixes.add(prefix);

    const namespaceA = `${prefix}_ns_a`;
    const namespaceB = `${prefix}_ns_b`;
    const token = `${prefix}_session_filter_token`;

    const service = new KVMemoryService();
    const sessionService = new SessionService();
    const { keyA, keyB } = await seedNamespaceSearchRecords(service, namespaceA, namespaceB, token);
    const session = await sessionService.generateSession(namespaceA);

    activeServer = createSearchServer(service, sessionService);

    const response = await fetch(`${activeServer.url}/search?q=${token}&session=${session}`);
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.results.length).toBeGreaterThan(0);

    const keys = (payload.data.results as Array<{ key: string }>).map((item) => item.key);
    expect(keys.includes(keyA)).toBe(true);
    expect(keys.includes(keyB)).toBe(false);
    expect(keys.every((key) => key.startsWith(`${namespaceA}:`))).toBe(true);
  });

  test("GET /search with invalid session returns 401", async () => {
    const service = new KVMemoryService();
    activeServer = createSearchServer(service, new SessionService());

    const response = await fetch(`${activeServer.url}/search?q=test&session=invalid_session_id`);
    expect(response.status).toBe(401);

    const payload = await response.json();
    expect(payload.success).toBe(false);
    expect(payload.message).toBe("invalid session");
  });

  test("GET /search without session keeps global search behavior", async () => {
    const prefix = createPrefix();
    cleanupPrefixes.add(prefix);

    const namespaceA = `${prefix}_ns_a`;
    const namespaceB = `${prefix}_ns_b`;
    const token = `${prefix}_global_search_token`;

    const service = new KVMemoryService();
    const { keyA, keyB } = await seedNamespaceSearchRecords(service, namespaceA, namespaceB, token);
    activeServer = createSearchServer(service, new SessionService());

    const response = await fetch(`${activeServer.url}/search?q=${token}`);
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.success).toBe(true);

    const keys = (payload.data.results as Array<{ key: string }>).map((item) => item.key);
    expect(keys.includes(keyA)).toBe(true);
    expect(keys.includes(keyB)).toBe(true);
  });

  test("GET /fulltext returns matched records and pagination", async () => {
    const prefix = createPrefix();
    cleanupPrefixes.add(prefix);

    const service = new KVMemoryService();
    await seedSearchRecords(service, prefix);
    activeServer = createSearchServer(service);

    const response = await fetch(`${activeServer.url}/fulltext?keywords=量子,计算&operator=OR&limit=2&offset=0`);
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(Array.isArray(payload.data.results)).toBe(true);
    expect(payload.data.pagination.limit).toBe(2);
    expect(payload.data.pagination.offset).toBe(0);

    const first = payload.data.results[0];
    expect(typeof first.key).toBe("string");
    expect(typeof first.summary).toBe("string");
    expect(typeof first.excerpt).toBe("string");
    expect(typeof first.relevance).toBe("number");
    expect(typeof first.score).toBe("number");
  });

  test("GET /fulltext returns 400 for invalid operator and empty keywords", async () => {
    const service = new KVMemoryService();
    activeServer = createSearchServer(service);

    const invalidOperator = await fetch(`${activeServer.url}/fulltext?keywords=a,b&operator=XOR`);
    expect(invalidOperator.status).toBe(400);
    const invalidOperatorPayload = await invalidOperator.json();
    expect(invalidOperatorPayload.success).toBe(false);
    expect(Array.isArray(invalidOperatorPayload.message)).toBe(true);

    const emptyKeywords = await fetch(`${activeServer.url}/fulltext?keywords=, ,`);
    expect(emptyKeywords.status).toBe(400);
    const emptyKeywordsPayload = await emptyKeywords.json();
    expect(emptyKeywordsPayload.success).toBe(false);
    expect(typeof emptyKeywordsPayload.message).toBe("string");
  });

  test("returns empty success payload when search capability is disabled", async () => {
    const service = createDisabledSearchService();
    activeServer = createSearchServer(service);

    const searchResponse = await fetch(`${activeServer.url}/search?q=test&limit=5&offset=2`);
    expect(searchResponse.status).toBe(200);
    const searchPayload = await searchResponse.json();
    expect(searchPayload.success).toBe(true);
    expect(searchPayload.data.results).toEqual([]);
    expect(searchPayload.data.pagination).toEqual({ total: 0, limit: 5, offset: 2 });

    const fulltextResponse = await fetch(`${activeServer.url}/fulltext?keywords=a,b&operator=AND&limit=3&offset=1`);
    expect(fulltextResponse.status).toBe(200);
    const fulltextPayload = await fulltextResponse.json();
    expect(fulltextPayload.success).toBe(true);
    expect(fulltextPayload.data.results).toEqual([]);
    expect(fulltextPayload.data.pagination).toEqual({ total: 0, limit: 3, offset: 1 });
  });

  test("returns 500 when search service throws errors", async () => {
    const service = createFailingSearchService("integration search failure");
    activeServer = createSearchServer(service);

    const searchResponse = await fetch(`${activeServer.url}/search?q=test`);
    expect(searchResponse.status).toBe(500);
    const searchPayload = await searchResponse.json();
    expect(searchPayload.success).toBe(false);
    expect(searchPayload.message).toBe("integration search failure");

    const fulltextResponse = await fetch(`${activeServer.url}/fulltext?keywords=a,b&operator=OR`);
    expect(fulltextResponse.status).toBe(500);
    const fulltextPayload = await fulltextResponse.json();
    expect(fulltextPayload.success).toBe(false);
    expect(fulltextPayload.message).toBe("integration search failure");
  });
});
