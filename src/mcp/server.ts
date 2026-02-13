/**
 * MCP server for KVDB memory (HTTP stream only)
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { FastMCP, type Tool, type ToolParameters } from "fastmcp";
import {
  createBulkReadMemoryTool as createMemoryBulkReadTool,
  createMemoryAddTool,
  createMemoryFulltextSearchTool,
  createMemoryGetTool,
  createMemoryRenameTool,
  createMemorySearchTool,
  createMemoryUpdateTool,
  createSessionNewTool,
} from "./tools";
import { createMemoryResourceTemplate } from "./resources";
import {
  captureMemoryPrompt,
  recallMemoryPrompt,
  initMemoryPrompt,
} from "./prompts";
import { KVMemoryService, SessionService } from "../service";

export const server = new FastMCP({
  name: "kvdb-mem",
  version: "1.6.0",
  instructions:
    "使用Key-Value数据库存储记忆,并通过记忆连接(Link)将各个记忆连接起来,模仿人类的记忆连接方式.",
  health: {
    enabled: true,
  },
  roots: {
    enabled: false,
  },
});

type McpSessionAuth = Record<string, unknown> | undefined;
type McpToolDefinition = Tool<McpSessionAuth, any>;

const toolRegistry = new Map<string, McpToolDefinition>();

const pickToolDefinition = <Params extends ToolParameters>(
  tool: Tool<McpSessionAuth, Params>,
) => ({
  description: tool.description,
  parameters: tool.parameters,
  execute: tool.execute,
});

const sessionService = new SessionService();
const kvMemoryService = new KVMemoryService();

const sessionNewTool = createSessionNewTool(sessionService);
const memoryAddTool = createMemoryAddTool(sessionService, kvMemoryService);
const memoryGetTool = createMemoryGetTool(sessionService, kvMemoryService);
const memoryUpdateTool = createMemoryUpdateTool(
  sessionService,
  kvMemoryService,
);
const memoryRenameTool = createMemoryRenameTool(
  sessionService,
  kvMemoryService,
);
const memorySearchTool = createMemorySearchTool(sessionService, kvMemoryService);
const memoryFulltextSearchTool = createMemoryFulltextSearchTool(
  sessionService,
  kvMemoryService,
);
const memoryBulkReadTool = createMemoryBulkReadTool(
  sessionService,
  kvMemoryService,
);

toolRegistry.set(sessionNewTool.name, sessionNewTool);
toolRegistry.set(memoryAddTool.name, memoryAddTool);
toolRegistry.set(memoryGetTool.name, memoryGetTool);
toolRegistry.set(memoryUpdateTool.name, memoryUpdateTool);
toolRegistry.set(memoryRenameTool.name, memoryRenameTool);
toolRegistry.set(memorySearchTool.name, memorySearchTool);
toolRegistry.set(memoryFulltextSearchTool.name, memoryFulltextSearchTool);
toolRegistry.set(memoryBulkReadTool.name, memoryBulkReadTool);

server.addTool({ name: "session_new", ...pickToolDefinition(sessionNewTool) });
server.addTool({ name: "memory_add", ...pickToolDefinition(memoryAddTool) });
server.addTool({ name: "memory_get", ...pickToolDefinition(memoryGetTool) });
server.addTool({
  name: "memory_update",
  ...pickToolDefinition(memoryUpdateTool),
});
server.addTool({
  name: "memory_rename",
  ...pickToolDefinition(memoryRenameTool),
});
server.addTool({
  name: "memory_search",
  ...pickToolDefinition(memorySearchTool),
});
server.addTool({
  name: "memory_fulltext_search",
  ...pickToolDefinition(memoryFulltextSearchTool),
});
server.addTool({
  name: "bulk_read_memory",
  ...pickToolDefinition(memoryBulkReadTool),
});

const memoryResourceTemplate = createMemoryResourceTemplate(kvMemoryService);
server.addResourceTemplate({
  uriTemplate: "memory://{namespace}/{key}",
  name: "KVDB Memory",
  description: memoryResourceTemplate.description,
  mimeType: "application/json",
  arguments: memoryResourceTemplate.arguments,
  load: memoryResourceTemplate.load,
});

server.addPrompt({
  name: "capture_memory",
  description: captureMemoryPrompt.description,
  arguments: captureMemoryPrompt.arguments,
  load: captureMemoryPrompt.load,
});
server.addPrompt({
  name: "recall_memory",
  description: recallMemoryPrompt.description,
  arguments: recallMemoryPrompt.arguments,
  load: recallMemoryPrompt.load,
});
server.addPrompt({
  name: "memory_init",
  description: initMemoryPrompt.description,
  arguments: initMemoryPrompt.arguments,
  load: initMemoryPrompt.load,
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
  const host = Bun.env.MCP_HOST ?? "127.0.0.1";
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
