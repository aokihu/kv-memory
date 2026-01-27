/**
 * MCP server for KVDB memory (HTTP stream only)
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { FastMCP, type Tool, type ToolParameters } from "fastmcp";
import {
  createMemoryAddTool,
  createMemoryGetTool,
  createMemoryRenameTool,
  createMemoryUpdateTool,
  createSessionNewTool,
} from "./tools";
import { createMemoryResourceTemplate } from "./resources";
import { captureMemoryPrompt, recallMemoryPrompt } from "./prompts";
import { KVMemoryService, SessionService } from "../service";

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

const sessionService = new SessionService();
const kvMemoryService = new KVMemoryService();

registerTool(createSessionNewTool(sessionService));
registerTool(createMemoryAddTool(sessionService, kvMemoryService));
registerTool(createMemoryGetTool(sessionService, kvMemoryService));
registerTool(createMemoryUpdateTool(sessionService, kvMemoryService));
registerTool(createMemoryRenameTool(sessionService, kvMemoryService));

server.addResourceTemplate(createMemoryResourceTemplate(kvMemoryService));

server.addPrompt(captureMemoryPrompt);
server.addPrompt(recallMemoryPrompt);

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
