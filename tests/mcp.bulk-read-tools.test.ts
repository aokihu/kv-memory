/**
 * MCP bulk read memory tool tests.
 *
 * This suite validates registration, argument parsing, session behavior,
 * output formats, and success/error payload shape for `bulk_read_memory`.
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
const testKeyPrefix = "mcp_bulk_read_test_";

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

async function seedBulkReadGraph(kvMemoryService: KVMemoryService, namespace: string): Promise<{
  rootKey: string;
  childKey: string;
}> {
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const rootKey = `${namespace}:${testKeyPrefix}${unique}_root`;
  const childKey = `${namespace}:${testKeyPrefix}${unique}_child`;

  await kvMemoryService.addMemory(childKey, {
    summary: "bulk child summary",
    text: "bulk child text",
  });

  await kvMemoryService.addMemory(
    rootKey,
    {
      summary: "bulk root summary",
      text: "bulk root text",
    },
    [{ type: "decision", key: childKey, term: "root-child", weight: 0.9 }],
  );

  return { rootKey, childKey };
}

function cleanupTestRows(): void {
  database
    .query("DELETE FROM memory_links WHERE from_key LIKE ? OR to_key LIKE ? OR from_key LIKE ? OR to_key LIKE ?")
    .run(`${testKeyPrefix}%`, `${testKeyPrefix}%`, `%:${testKeyPrefix}%`, `%:${testKeyPrefix}%`);
  database
    .query("DELETE FROM memories WHERE key LIKE ? OR key LIKE ?")
    .run(`${testKeyPrefix}%`, `%:${testKeyPrefix}%`);
}

afterEach(() => {
  cleanupTestRows();
});

describe("MCP bulk_read_memory tool", () => {
  test("registers bulk_read_memory tool", () => {
    expect(() => resolveTool("bulk_read_memory")).not.toThrow();
  });

  test("executes basic bulk read and returns MCP text content with json payload", async () => {
    const kvMemoryService = new KVMemoryService();
    const namespace = `${testKeyPrefix}${Date.now()}_basic_ns`;
    const { rootKey, childKey } = await seedBulkReadGraph(kvMemoryService, namespace);

    const result = await callRegisteredTool("bulk_read_memory", {
      key: rootKey,
      depth: 3,
      breadth: 5,
      total: 20,
      output_format: "json",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");

    const payload = parseJsonPayload(result);
    expect(payload.success).toBe(true);

    const data = payload.data as {
      targetMemory: { key: string; summary: string; text: string };
      associatedMemories: Array<{ key: string }>;
      metadata: { depthReached: number; totalRetrieved: number; duplicatesSkipped: number };
    };

    expect(data.targetMemory.key).toBe(rootKey);
    expect(typeof data.targetMemory.summary).toBe("string");
    expect(typeof data.targetMemory.text).toBe("string");
    expect(data.associatedMemories.map((item) => item.key)).toContain(childKey);
    expect(typeof data.metadata.depthReached).toBe("number");
    expect(typeof data.metadata.totalRetrieved).toBe("number");
    expect(typeof data.metadata.duplicatesSkipped).toBe("number");
  });

  test("validates depth, breadth and total parameter ranges", async () => {
    const invalidDepthResult = await callRegisteredTool("bulk_read_memory", {
      key: `${testKeyPrefix}${Date.now()}_invalid_depth_key`,
      depth: 7,
      output_format: "json",
    });
    expect(invalidDepthResult.isError).toBe(true);
    expect(invalidDepthResult.content[0]?.text.length).toBeGreaterThan(0);

    const invalidBreadthResult = await callRegisteredTool("bulk_read_memory", {
      key: `${testKeyPrefix}${Date.now()}_invalid_breadth_key`,
      breadth: 21,
      output_format: "json",
    });
    expect(invalidBreadthResult.isError).toBe(true);
    expect(invalidBreadthResult.content[0]?.text.length).toBeGreaterThan(0);

    const invalidTotalResult = await callRegisteredTool("bulk_read_memory", {
      key: `${testKeyPrefix}${Date.now()}_invalid_total_key`,
      total: 51,
      output_format: "json",
    });
    expect(invalidTotalResult.isError).toBe(true);
    expect(invalidTotalResult.content[0]?.text.length).toBeGreaterThan(0);
  });

  test("handles valid and invalid session values", async () => {
    const kvMemoryService = new KVMemoryService();
    const namespace = `${testKeyPrefix}${Date.now()}_session_ns`;
    const session = await createServerSession(namespace);
    const { rootKey } = await seedBulkReadGraph(kvMemoryService, namespace);

    const validSessionResult = await callRegisteredTool("bulk_read_memory", {
      key: rootKey,
      session,
      output_format: "json",
    });
    const validSessionPayload = parseJsonPayload(validSessionResult);
    expect(validSessionPayload.success).toBe(true);

    const invalidSessionResult = await callRegisteredTool("bulk_read_memory", {
      key: rootKey,
      session: "invalid_session_id",
      output_format: "json",
    });
    const invalidSessionPayload = parseJsonPayload(invalidSessionResult);
    expect(invalidSessionPayload.success).toBe(false);
    expect(invalidSessionPayload.message).toBe("invalid session");
  });

  test("supports toon and json output formats", async () => {
    const kvMemoryService = new KVMemoryService();
    const namespace = `${testKeyPrefix}${Date.now()}_format_ns`;
    const { rootKey } = await seedBulkReadGraph(kvMemoryService, namespace);

    const toonResult = await callRegisteredTool("bulk_read_memory", {
      key: rootKey,
      output_format: "toon",
    });
    expect(toonResult.isError).toBeUndefined();
    expect(toonResult.content).toHaveLength(1);
    expect(toonResult.content[0]?.text.length).toBeGreaterThan(0);
    expect(isJsonString(toonResult.content[0]!.text)).toBe(false);

    const jsonResult = await callRegisteredTool("bulk_read_memory", {
      key: rootKey,
      output_format: "json",
    });
    expect(jsonResult.isError).toBeUndefined();
    expect(jsonResult.content).toHaveLength(1);
    expect(isJsonString(jsonResult.content[0]!.text)).toBe(true);
  });

  test("returns memory not found payload when key does not exist", async () => {
    const result = await callRegisteredTool("bulk_read_memory", {
      key: `${testKeyPrefix}${Date.now()}_missing_key`,
      output_format: "json",
    });

    expect(result.isError).toBeUndefined();
    const payload = parseJsonPayload(result);
    expect(payload.success).toBe(false);
    expect(payload.message).toBe("memory not found");
  });
});
