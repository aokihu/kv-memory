/**
 * MCP server for KVDB memory (HTTP stream only)
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { FastMCP, type Tool, type ToolParameters } from "fastmcp";
import { KVMemoryService, SessionService } from "../service";
import type { MemoryNoMetaWithLinkSummary } from "../service/kvmemory";
import { type MemoryNoMeta } from "../type";
import {
  MemoryAddSchema,
  MemoryGetSchema,
  MemoryRenameSchema,
  MemoryUpdateSchema,
} from "./schemas/memory";
import { SessionCreateSchema } from "./schemas/session";

const sessionService = new SessionService();
const kvMemoryService = new KVMemoryService();

export const server = new FastMCP({
  name: "kvdb-mem",
  version: "0.1.1",
  instructions:
    "使用Key-Value数据库存储记忆,并通过记忆连接(Link)将各个记忆连接起来,模仿人类的记忆连接方式.",
});

type McpSessionAuth = Record<string, unknown> | undefined;
type McpToolDefinition = Tool<McpSessionAuth, ToolParameters>;

const toolRegistry = new Map<string, McpToolDefinition>();
const registerTool = <Params extends ToolParameters>(
  tool: Tool<McpSessionAuth, Params>,
) => {
  toolRegistry.set(tool.name, tool);
  server.addTool(tool);
};

registerTool({
  name: "session_new",
  description: "创建新的session,每个session最多保持3分钟时效",
  parameters: SessionCreateSchema,
  execute: async (args) => {
    const namespace = args.namespace ?? "mem";
    const sessionKey = await sessionService.generateSession(namespace);
    return JSON.stringify(sessionKey);
  },
});

registerTool({
  name: "memory_add",
  description: "Add a memory record",
  parameters: MemoryAddSchema,
  execute: async (args) => {
    try {
      const sessionData = await sessionService.getSession(args.session);
      if (!sessionData) {
        return JSON.stringify({ success: false, message: "invalid session" }, null, 2);
      }
      const namespace = sessionData.kv_namespace;
      const value: MemoryNoMeta = {
        ...args.value,
        links: args.value.links ?? [],
        keywords: args.value.keywords ?? [],
      };

      await kvMemoryService.addMemory(namespace, args.key, value);

      return JSON.stringify({ success: true }, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return JSON.stringify({ success: false, message }, null, 2);
    }
  },
});

registerTool({
  name: "memory_get",
  description: "Get a memory record with session-aware traversal",
  parameters: MemoryGetSchema,
  execute: async (args) => {
    try {
      const sessionData = await sessionService.getSession(args.session);
      if (!sessionData) {
        return JSON.stringify({ success: false, message: "invalid session" }, null, 2);
      }

      const namespace = sessionData.kv_namespace;
      const lastMemoryKey = sessionData.last_memory_key;

      if (lastMemoryKey !== "") {
        await kvMemoryService.traverseMemory(namespace, lastMemoryKey);
      }

      const memory: MemoryNoMetaWithLinkSummary | undefined =
        await kvMemoryService.getMemory(namespace, args.key);

      if (!memory) {
        return JSON.stringify({ success: false, message: "memory not found" }, null, 2);
      }

      await sessionService.setSession(args.session, {
        last_memory_key: args.key,
      });

      return JSON.stringify(
        {
          success: true,
          data: memory,
        },
        null,
        2,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return JSON.stringify({ success: false, message }, null, 2);
    }
  },
});

registerTool({
  name: "memory_update",
  description: "Update a memory record",
  parameters: MemoryUpdateSchema,
  execute: async (args) => {
    try {
      const sessionData = await sessionService.getSession(args.session);
      if (!sessionData) {
        return JSON.stringify({ success: false, message: "invalid session" }, null, 2);
      }

      const namespace = sessionData.kv_namespace;

      const existingMemory = await kvMemoryService.getMemory(namespace, args.key);
      if (!existingMemory) {
        return JSON.stringify({ success: false, message: "memory not found" }, null, 2);
      }

      await kvMemoryService.updateMemory(namespace, args.key, args.value);

      return JSON.stringify({ success: true, data: { key: args.key } }, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return JSON.stringify({ success: false, message }, null, 2);
    }
  },
});

registerTool({
  name: "memory_rename",
  description: "Rename a memory key",
  parameters: MemoryRenameSchema,
  execute: async (args) => {
    try {
      const sessionData = await sessionService.getSession(args.session);
      if (!sessionData) {
        return JSON.stringify({ success: false, message: "invalid session" }, null, 2);
      }

      const namespace = sessionData.kv_namespace;

      if (args.old_key === args.new_key) {
        return JSON.stringify(
          { success: false, message: "old_key and new_key must be different" },
          null,
          2,
        );
      }

      const oldMemory = await kvMemoryService.getMemory(namespace, args.old_key);
      if (!oldMemory) {
        return JSON.stringify({ success: false, message: "memory not found" }, null, 2);
      }

      const newMemory = await kvMemoryService.getMemory(namespace, args.new_key);
      if (newMemory) {
        return JSON.stringify({ success: false, message: "key already exists" }, null, 2);
      }

      await kvMemoryService.updateKey(namespace, args.old_key, args.new_key);

      return JSON.stringify(
        { success: true, data: { old_key: args.old_key, new_key: args.new_key } },
        null,
        2,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return JSON.stringify({ success: false, message }, null, 2);
    }
  },
});

server.addResourceTemplate({
  uriTemplate: "memory://{namespace}/{key}",
  name: "KVDB Memory",
  description: "Read-only access to memory records",
  mimeType: "application/json",
  arguments: [
    {
      name: "namespace",
      description: "Memory namespace (defaults to mem)",
      required: false,
    },
    {
      name: "key",
      description: "Memory key",
      required: true,
    },
  ],
  load: async (args) => {
    const namespace = (args.namespace as string | undefined) ?? "mem";
    try {
      const memory: MemoryNoMetaWithLinkSummary | undefined =
        await kvMemoryService.getMemory(namespace, args.key);
      return {
        uri: `memory://${namespace}/${args.key}`,
        text: JSON.stringify(memory, null, 2),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return {
        uri: `memory://${namespace}/${args.key}`,
        text: JSON.stringify({ success: false, message }, null, 2),
      };
    }
  },
});

server.addPrompt({
  name: "capture_memory",
  description: "Guide an agent to create a structured memory record",
  arguments: [
    {
      name: "key",
      description: "Unique memory key",
      required: true,
    },
  ],
  load: async ({ key }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Create a structured memory payload for KVDB. Output JSON with:\n" +
              "- key (string)\n" +
              "- value.domain (string)\n" +
              "- value.summary (string, 1-2 sentences)\n" +
              "- value.text (string, detailed)\n" +
              "- value.type (string)\n" +
              "- value.links (array of { type, term, weight })\n" +
              "- value.keywords (array of strings)\n\n" +
              `Use key: ${key}. Keep links empty when unknown.`,
          },
        },
      ],
    };
  },
});

server.addPrompt({
  name: "recall_memory",
  description: "Guide an agent to recall memory by key",
  arguments: [
    {
      name: "key",
      description: "Memory key",
      required: true,
    },
  ],
  load: async ({ key }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Recall a memory record by key. Use the memory_get tool with:\n" +
              `- key: ${key}\n` +
              "If you do not have a session, call session_new first.",
          },
        },
      ],
    };
  },
});

Object.assign(
  server as FastMCP & {
    _tools: Map<string, McpToolDefinition>;
    getTool: (name: string) => McpToolDefinition | undefined;
  },
  {
    _tools: toolRegistry,
    getTool: (name: string) => toolRegistry.get(name),
  },
);

export const startMcpServer = async () => {
  const port = Number(Bun.env.MCP_PORT ?? "8787");
  const host = Bun.env.MCP_HOST;
  const endpoint = (Bun.env.MCP_ENDPOINT ?? "/mcp") as `/${string}`;

  await server.start({
    transportType: "httpStream",
    httpStream: {
      port,
      host,
      endpoint,
    },
  });
};

if (import.meta.main) {
  startMcpServer().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("Failed to start MCP server:", message);
  });
}
