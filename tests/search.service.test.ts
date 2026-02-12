/**
 * SearchService unit tests with mocked DB and KV dependencies.
 *
 * Debug hint:
 * - If import mocking fails, check `mock.module` target path first.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Memory } from "../src/type";

type FakeSearchRow = {
  key: string;
  summary: string;
  text: string;
  rank: number | null;
  excerpt: string | null;
};

type FakeDbState = {
  allRows: FakeSearchRow[];
  total: number;
  throwOnQuery: boolean;
  searchEnabled: boolean;
  capturedAllParams: unknown[];
  capturedGetParams: unknown[];
};

const fakeDbState: FakeDbState = {
  allRows: [],
  total: 0,
  throwOnQuery: false,
  searchEnabled: true,
  capturedAllParams: [],
  capturedGetParams: [],
};

const fakeDatabase = {
  query(sql: string) {
    return {
      all(...params: unknown[]) {
        fakeDbState.capturedAllParams = [sql, ...params];
        if (fakeDbState.throwOnQuery) {
          throw new Error("fake-db-query-failed");
        }
        return fakeDbState.allRows;
      },
      get(...params: unknown[]) {
        fakeDbState.capturedGetParams = [sql, ...params];
        if (fakeDbState.throwOnQuery) {
          throw new Error("fake-db-query-failed");
        }
        return { total: fakeDbState.total };
      },
    };
  },
};

mock.module("../src/libs/kv/db", () => {
  return {
    getDatabase: () => fakeDatabase,
    initDatabase: () => fakeDatabase,
    getDatabaseConfig: () => ({
      searchEnabled: fakeDbState.searchEnabled,
    }),
  };
});

const { SearchService } = await import("../src/service/searchService");

function createService(memoryMap: Record<string, Memory | undefined>) {
  const kv = {
    async get(key: string) {
      return memoryMap[key];
    },
  };

  return new SearchService(kv as never);
}

beforeEach(() => {
  fakeDbState.allRows = [];
  fakeDbState.total = 0;
  fakeDbState.throwOnQuery = false;
  fakeDbState.searchEnabled = true;
  fakeDbState.capturedAllParams = [];
  fakeDbState.capturedGetParams = [];
});

afterAll(() => {
  mock.restore();
});

describe("SearchService", () => {
  test("search supports single keyword and basic result format", async () => {
    fakeDbState.allRows = [
      {
        key: "mem:1",
        summary: "row summary",
        text: "row text",
        rank: -2,
        excerpt: "<mark>alpha</mark> excerpt",
      },
    ];
    fakeDbState.total = 1;

    const service = createService({});
    const result = await service.search("alpha");

    expect(fakeDbState.capturedAllParams[1]).toBe('"alpha"');
    expect(result.pagination).toEqual({
      total: 1,
      limit: 10,
      offset: 0,
    });
    expect(result.results).toEqual([
      {
        key: "mem:1",
        summary: "row summary",
        excerpt: "<mark>alpha</mark> excerpt",
        relevance: 0.333333,
        score: 0.333333,
      },
    ]);
  });

  test("search tokenizes multi-term query with OR expression", async () => {
    fakeDbState.allRows = [];
    fakeDbState.total = 0;

    const service = createService({});
    await service.search("alpha   beta gamma", 8, 2);

    expect(fakeDbState.capturedAllParams[1]).toBe('"alpha" OR "beta" OR "gamma"');
    expect(fakeDbState.capturedAllParams[2]).toBe(8);
    expect(fakeDbState.capturedAllParams[3]).toBe(2);
    expect(fakeDbState.capturedGetParams[1]).toBe('"alpha" OR "beta" OR "gamma"');
  });

  test("search applies namespace prefix filter when namespace is provided", async () => {
    fakeDbState.allRows = [];
    fakeDbState.total = 0;

    const service = createService({});
    await service.search("alpha", 6, 1, "ns-one");

    expect(typeof fakeDbState.capturedAllParams[0]).toBe("string");
    expect((fakeDbState.capturedAllParams[0] as string).includes("AND key LIKE ?")).toBe(true);
    expect(fakeDbState.capturedAllParams[1]).toBe('"alpha"');
    expect(fakeDbState.capturedAllParams[2]).toBe("ns-one:%");
    expect(fakeDbState.capturedAllParams[3]).toBe(6);
    expect(fakeDbState.capturedAllParams[4]).toBe(1);

    expect(typeof fakeDbState.capturedGetParams[0]).toBe("string");
    expect((fakeDbState.capturedGetParams[0] as string).includes("AND key LIKE ?")).toBe(true);
    expect(fakeDbState.capturedGetParams[1]).toBe('"alpha"');
    expect(fakeDbState.capturedGetParams[2]).toBe("ns-one:%");
  });

  test("search keeps global mode when namespace is missing or blank", async () => {
    fakeDbState.allRows = [];
    fakeDbState.total = 0;

    const service = createService({});
    await service.search("alpha", 4, 2);
    expect((fakeDbState.capturedAllParams[0] as string).includes("AND key LIKE ?")).toBe(false);
    expect(fakeDbState.capturedAllParams[2]).toBe(4);
    expect(fakeDbState.capturedAllParams[3]).toBe(2);

    await service.search("alpha", 4, 2, "   ");
    expect((fakeDbState.capturedAllParams[0] as string).includes("AND key LIKE ?")).toBe(false);
    expect(fakeDbState.capturedAllParams[2]).toBe(4);
    expect(fakeDbState.capturedAllParams[3]).toBe(2);
  });

  test("search returns empty result with valid pagination when no match", async () => {
    fakeDbState.allRows = [];
    fakeDbState.total = 0;

    const service = createService({});
    const result = await service.search("not-found", 5, 1);

    expect(result.results).toEqual([]);
    expect(result.pagination).toEqual({
      total: 0,
      limit: 5,
      offset: 1,
    });
  });

  test("search normalizes pagination and uses fallback excerpt from memory text", async () => {
    const longText = `${"x".repeat(170)}tail`;
    fakeDbState.allRows = [
      {
        key: "mem:2",
        summary: "row summary",
        text: "row text",
        rank: 0,
        excerpt: null,
      },
    ];
    fakeDbState.total = 1;

    const service = createService({
      "mem:2": {
        summary: "memory summary",
        text: longText,
      } as Memory,
    });
    const result = await service.search("alpha", 1000, 3.8);

    expect(fakeDbState.capturedAllParams[2]).toBe(100);
    expect(fakeDbState.capturedAllParams[3]).toBe(3);
    expect(result.pagination.limit).toBe(100);
    expect(result.pagination.offset).toBe(3);
    expect(result.results[0]?.summary).toBe("memory summary");
    expect(result.results[0]?.excerpt.length).toBe(160);
    expect(result.results[0]?.excerpt.endsWith("...")).toBe(true);
  });

  test("fulltextSearch uses OR operator and keeps highlight excerpt", async () => {
    fakeDbState.allRows = [
      {
        key: "mem:3",
        summary: "row summary",
        text: "row text",
        rank: -0.5,
        excerpt: "prefix <mark>alpha</mark> suffix",
      },
    ];
    fakeDbState.total = 1;

    const service = createService({});
    const result = await service.fulltextSearch([" alpha ", "beta"], "OR", 7, 4);

    expect(fakeDbState.capturedAllParams[1]).toBe('"alpha" OR "beta"');
    expect(fakeDbState.capturedAllParams[2]).toBe(7);
    expect(fakeDbState.capturedAllParams[3]).toBe(4);
    expect(result.results[0]?.excerpt).toBe("prefix <mark>alpha</mark> suffix");
    expect(result.results[0]?.relevance).toBe(0.666667);
  });

  test("fulltextSearch supports AND operator", async () => {
    fakeDbState.allRows = [];
    fakeDbState.total = 0;

    const service = createService({});
    const result = await service.fulltextSearch(["alpha", "beta"], "AND", 3, 2);

    expect(fakeDbState.capturedAllParams[1]).toBe('"alpha" AND "beta"');
    expect(result.pagination).toEqual({
      total: 0,
      limit: 3,
      offset: 2,
    });
  });

  test("fulltextSearch returns empty result structure when no rows", async () => {
    fakeDbState.allRows = [];
    fakeDbState.total = 0;

    const service = createService({});
    const result = await service.fulltextSearch(["missing"], "OR", 2, 0);

    expect(result.results).toEqual([]);
    expect(result.pagination).toEqual({
      total: 0,
      limit: 2,
      offset: 0,
    });
  });

  test("search validates query and pagination arguments", async () => {
    const service = createService({});

    await expect(service.search("")).rejects.toThrow(
      "SearchService: query is required and must be a non-empty string",
    );
    await expect(service.search("ok", 0, 0)).rejects.toThrow("SearchService: limit must be a positive number");
    await expect(service.search("ok", 1, -1)).rejects.toThrow("SearchService: offset must be a non-negative number");
  });

  test("fulltextSearch validates keywords, operator, and pagination arguments", async () => {
    const service = createService({});

    await expect(service.fulltextSearch([])).rejects.toThrow(
      "SearchService: keywords are required and must be a non-empty string array",
    );
    await expect(service.fulltextSearch(["alpha"], "XOR" as never)).rejects.toThrow(
      "SearchService: operator must be AND or OR",
    );
    await expect(service.fulltextSearch(["alpha"], "OR", 1, -1)).rejects.toThrow(
      "SearchService: offset must be a non-negative number",
    );
  });

  test("search and fulltextSearch return empty when search is disabled", async () => {
    fakeDbState.searchEnabled = false;
    fakeDbState.allRows = [
      {
        key: "mem:disabled",
        summary: "should not be used",
        text: "should not be used",
        rank: -1,
        excerpt: "<mark>disabled</mark>",
      },
    ];
    fakeDbState.total = 1;

    const service = createService({});
    const basicResult = await service.search("alpha", 9, 2);
    const fulltextResult = await service.fulltextSearch(["alpha"], "AND", 3, 1);

    expect(basicResult).toEqual({
      results: [],
      pagination: {
        total: 0,
        limit: 9,
        offset: 2,
      },
    });
    expect(fulltextResult).toEqual({
      results: [],
      pagination: {
        total: 0,
        limit: 3,
        offset: 1,
      },
    });
    expect(fakeDbState.capturedAllParams).toEqual([]);
    expect(fakeDbState.capturedGetParams).toEqual([]);
  });

  test("throws unified execution error when DB query fails", async () => {
    fakeDbState.throwOnQuery = true;

    const service = createService({});

    await expect(service.search("alpha")).rejects.toThrow("SearchService: search query execution failed");
    await expect(service.fulltextSearch(["alpha"], "OR")).rejects.toThrow(
      "SearchService: search query execution failed",
    );
  });
});
