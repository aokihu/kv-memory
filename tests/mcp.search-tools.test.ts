/**
 * MCP search tools tests.
 *
 * This suite validates registration, parameter parsing, execution payload,
 * and MCP-like call result envelope for memory search tools.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { getDatabase, initDatabase } from "../src/libs/kv/db";
import { server } from "../src/mcp/server";
import { KVMemoryService } from "../src/service";

type McpToolExecute = (args: unknown, context?: unknown) => Promise<string>;

type McpToolLike = {
  name: string;
  parameters: {
    safeParse: (input: unknown) =>
      | { success: true; data: unknown }
      | { success: false; error: { issues: Array<{ message: string }> } };
  };
  execute: McpToolExecute;
};

type McpCallResult = {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
};

const database = initDatabase(getDatabase());
const testKeyPrefix = "mcp_search_test_";

function resolveTool(name: string): McpToolLike {
  const registered = (server as { getTool?: (toolName: string) => unknown }).getTool?.(name);
  if (!registered) {
    throw new Error(`tool not registered: ${name}`);
  }

  return registered as McpToolLike;
}

async function callRegisteredTool(name: string, rawArgs: unknown): Promise<McpCallResult> {
  const tool = resolveTool(name);
  const parsed = tool.parameters.safeParse(rawArgs);

  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message ?? "invalid tool arguments";
    return {
      isError: true,
      content: [{ type: "text", text: issue }],
    };
  }

  const text = await tool.execute(parsed.data);
  return {
    content: [{ type: "text", text }],
  };
}

async function createServerSession(namespace: string): Promise<string> {
  const result = await callRegisteredTool("session_new", { namespace });
  const payload = parseJsonPayload(result) as {
    success: boolean;
    data?: { sessionKey?: string };
  };

  if (!payload.success || !payload.data?.sessionKey) {
    throw new Error("failed to create test session from MCP server");
  }

  return payload.data.sessionKey;
}

function parseJsonPayload(result: McpCallResult): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

function isJsonString(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

async function seedNamespaceRecords(
  kvMemoryService: KVMemoryService,
  namespaceA: string,
  namespaceB: string,
  token: string,
): Promise<{ keyA: string; keyB: string }> {
  const keyA = `${namespaceA}:${testKeyPrefix}${Date.now()}_namespace_a`;
  const keyB = `${namespaceB}:${testKeyPrefix}${Date.now()}_namespace_b`;

  await kvMemoryService.addMemory(keyA, {
    summary: "mcp namespace A",
    text: `search token ${token} exists in namespace A`,
  });

  await kvMemoryService.addMemory(keyB, {
    summary: "mcp namespace B",
    text: `search token ${token} exists in namespace B`,
  });

  return { keyA, keyB };
}

function cleanupTestRows(): void {
  database.query("DELETE FROM memory_links WHERE from_key LIKE ? OR to_key LIKE ?").run(`${testKeyPrefix}%`, `${testKeyPrefix}%`);
  database.query("DELETE FROM memories WHERE key LIKE ?").run(`${testKeyPrefix}%`);
}

afterEach(() => {
  cleanupTestRows();
});

describe("MCP search tools", () => {
  test("registers memory_search and memory_fulltext_search tools", () => {
    expect(() => resolveTool("memory_search")).not.toThrow();
    expect(() => resolveTool("memory_fulltext_search")).not.toThrow();
  });

  test("calls memory_search and returns MCP text content with success payload", async () => {
    const kvMemoryService = new KVMemoryService();
    const uniqueToken = `${testKeyPrefix}${Date.now()}_query_token`;
    const namespace = `${testKeyPrefix}${Date.now()}_search_ns`;
    const session = await createServerSession(namespace);
    const key = `${namespace}:${testKeyPrefix}${Date.now()}_search_key`;

    await kvMemoryService.addMemory(key, {
      summary: "mcp search summary",
      text: `body contains ${uniqueToken}`,
    });

    const result = await callRegisteredTool("memory_search", {
      query: uniqueToken,
      session,
      limit: 10,
      offset: 0,
      output_format: "json",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");

    const payload = parseJsonPayload(result);
    expect(payload.success).toBe(true);
    expect(payload.data).toBeObject();

    const data = payload.data as {
      results: Array<{ key: string; summary: string; excerpt: string; relevance: number; score: number }>;
      pagination: { total: number; limit: number; offset: number };
    };

    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0]?.key).toBe(key);
    expect(typeof data.results[0]?.summary).toBe("string");
    expect(typeof data.results[0]?.excerpt).toBe("string");
    expect(typeof data.results[0]?.relevance).toBe("number");
    expect(typeof data.results[0]?.score).toBe("number");
    expect(data.pagination.total).toBeGreaterThanOrEqual(1);
    expect(data.pagination.limit).toBe(10);
    expect(data.pagination.offset).toBe(0);
  });

  test("calls memory_fulltext_search and returns MCP text content with success payload", async () => {
    const kvMemoryService = new KVMemoryService();
    const keywordA = `${testKeyPrefix}${Date.now()}_kw_a`;
    const keywordB = `${testKeyPrefix}${Date.now()}_kw_b`;
    const namespace = `${testKeyPrefix}${Date.now()}_fulltext_ns`;
    const session = await createServerSession(namespace);
    const key = `${namespace}:${testKeyPrefix}${Date.now()}_fulltext_key`;

    await kvMemoryService.addMemory(key, {
      summary: "mcp fulltext summary",
      text: `document with ${keywordA} and ${keywordB}`,
    });

    const result = await callRegisteredTool("memory_fulltext_search", {
      keywords: `${keywordA},${keywordB}`,
      session,
      operator: "AND",
      limit: 10,
      offset: 0,
      output_format: "json",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");

    const payload = parseJsonPayload(result);
    expect(payload.success).toBe(true);
    expect(payload.data).toBeObject();

    const data = payload.data as {
      results: Array<{ key: string; summary: string; excerpt: string; relevance: number; score: number }>;
      pagination: { total: number; limit: number; offset: number };
    };

    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0]?.key).toBe(key);
    expect(typeof data.results[0]?.summary).toBe("string");
    expect(typeof data.results[0]?.excerpt).toBe("string");
    expect(typeof data.results[0]?.relevance).toBe("number");
    expect(typeof data.results[0]?.score).toBe("number");
    expect(data.pagination.total).toBeGreaterThanOrEqual(1);
    expect(data.pagination.limit).toBe(10);
    expect(data.pagination.offset).toBe(0);
  });

  test("memory_search with valid session only returns target namespace records", async () => {
    const kvMemoryService = new KVMemoryService();
    const namespaceA = `${testKeyPrefix}${Date.now()}_ns_a`;
    const namespaceB = `${testKeyPrefix}${Date.now()}_ns_b`;
    const token = `${testKeyPrefix}${Date.now()}_session_token`;
    const { keyA, keyB } = await seedNamespaceRecords(kvMemoryService, namespaceA, namespaceB, token);
    const session = await createServerSession(namespaceA);

    const result = await callRegisteredTool("memory_search", {
      query: token,
      session,
      output_format: "json",
    });

    const payload = parseJsonPayload(result);
    expect(payload.success).toBe(true);

    const data = payload.data as {
      results: Array<{ key: string }>;
    };
    const keys = data.results.map((item) => item.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.includes(keyA)).toBe(true);
    expect(keys.includes(keyB)).toBe(false);
    expect(keys.every((key) => key.startsWith(`${namespaceA}:`))).toBe(true);
  });

  test("memory_search with invalid session returns invalid session payload", async () => {
    const result = await callRegisteredTool("memory_search", {
      query: "test",
      session: "invalid_session_id",
      output_format: "json",
    });

    expect(result.isError).toBeUndefined();
    const payload = parseJsonPayload(result);
    expect(payload.success).toBe(false);
    expect(payload.message).toBe("invalid session");
  });

  test("memory_fulltext_search with invalid session returns invalid session payload", async () => {
    const result = await callRegisteredTool("memory_fulltext_search", {
      keywords: "test",
      operator: "OR",
      session: "invalid_session_id",
      output_format: "json",
    });

    expect(result.isError).toBeUndefined();
    const payload = parseJsonPayload(result);
    expect(payload.success).toBe(false);
    expect(payload.message).toBe("invalid session");
  });

  test("returns validation error for invalid memory_search arguments when session is required", async () => {
    const session = await createServerSession(`${testKeyPrefix}${Date.now()}_validation_search_ns`);

    const invalidQueryResult = await callRegisteredTool("memory_search", {
      query: "   ",
      session,
      output_format: "json",
    });

    expect(invalidQueryResult.isError).toBe(true);
    expect(invalidQueryResult.content).toHaveLength(1);
    expect(invalidQueryResult.content[0]?.text.length).toBeGreaterThan(0);

    const invalidPaginationResult = await callRegisteredTool("memory_search", {
      query: "valid",
      session,
      limit: 101,
      output_format: "json",
    });

    expect(invalidPaginationResult.isError).toBe(true);
    expect(invalidPaginationResult.content).toHaveLength(1);
    expect(invalidPaginationResult.content[0]?.text.length).toBeGreaterThan(0);
  });

  test("returns validation and execution errors for memory_fulltext_search when session is required", async () => {
    const session = await createServerSession(`${testKeyPrefix}${Date.now()}_validation_fulltext_ns`);

    const invalidOperatorResult = await callRegisteredTool("memory_fulltext_search", {
      keywords: "a,b",
      operator: "XOR",
      session,
      output_format: "json",
    });

    expect(invalidOperatorResult.isError).toBe(true);
    expect(invalidOperatorResult.content).toHaveLength(1);
    expect(invalidOperatorResult.content[0]?.text.length).toBeGreaterThan(0);

    const invalidKeywordResult = await callRegisteredTool("memory_fulltext_search", {
      keywords: "   ",
      session,
      output_format: "json",
    });

    expect(invalidKeywordResult.isError).toBe(true);
    expect(invalidKeywordResult.content).toHaveLength(1);
    expect(invalidKeywordResult.content[0]?.text.length).toBeGreaterThan(0);

    const emptyKeywordExecutionResult = await callRegisteredTool("memory_fulltext_search", {
      keywords: ",,,",
      session,
      output_format: "json",
    });

    expect(emptyKeywordExecutionResult.isError).toBeUndefined();
    const payload = parseJsonPayload(emptyKeywordExecutionResult);
    expect(payload.success).toBe(false);
    expect(payload.message).toBe("keywords must contain at least one non-empty value");
  });

  test("supports toon output for memory_search and memory_fulltext_search with required session", async () => {
    const kvMemoryService = new KVMemoryService();
    const token = `${testKeyPrefix}${Date.now()}_toon_token`;
    const namespace = `${testKeyPrefix}${Date.now()}_toon_ns`;
    const session = await createServerSession(namespace);
    const key = `${namespace}:${testKeyPrefix}${Date.now()}_toon_key`;

    await kvMemoryService.addMemory(key, {
      summary: "toon summary",
      text: `toon body ${token}`,
    });

    const searchToon = await callRegisteredTool("memory_search", {
      query: token,
      session,
      output_format: "toon",
    });
    expect(searchToon.isError).toBeUndefined();
    expect(searchToon.content).toHaveLength(1);
    expect(searchToon.content[0]?.text.length).toBeGreaterThan(0);
    expect(isJsonString(searchToon.content[0]!.text)).toBe(false);

    const fulltextToon = await callRegisteredTool("memory_fulltext_search", {
      keywords: token,
      operator: "OR",
      session,
      output_format: "toon",
    });
    expect(fulltextToon.isError).toBeUndefined();
    expect(fulltextToon.content).toHaveLength(1);
    expect(fulltextToon.content[0]?.text.length).toBeGreaterThan(0);
    expect(isJsonString(fulltextToon.content[0]!.text)).toBe(false);
  });
});
