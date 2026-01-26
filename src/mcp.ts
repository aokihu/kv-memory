/**
 * MCP server for KVDB memory
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import { KVMemoryService, SessionService } from "./service";
import type { MemoryNoMetaWithLinkSummary } from "./service/kvmemory";
import {
  MemoryNoMetaSchema,
  type MemoryNoMeta,
  type SessionValue,
} from "./type";

type McpSessionData = {
  sessionKey?: string;
};

const sessionService = new SessionService();
const kvMemoryService = new KVMemoryService();

const server = new FastMCP<McpSessionData>({
  name: "kvdb-mem",
  version: "0.1.0",
  instructions:
    "KVDB memory MCP server. Use session_new to create a session and memory_add/memory_get/memory_update/memory_rename to manage memories.",
});

const MemoryLinkInputSchema = MemoryNoMetaSchema.shape.links.element.extend({
  key: z.string().optional(),
});

const MemoryValueSchema = MemoryNoMetaSchema.extend({
  links: z.array(MemoryLinkInputSchema).optional(),
  keywords: MemoryNoMetaSchema.shape.keywords.optional(),
});

const MemoryAddSchema = z.object({
  key: z.string().min(1),
  value: MemoryValueSchema,
});

const MemoryGetSchema = z.object({
  key: z.string().min(1),
  session: z.string().min(1).optional(),
});

const MemoryUpdateSchema = z.object({
  key: z.string().min(1),
  value: MemoryNoMetaSchema.partial(),
  session: z.string().min(1).optional(),
});

const MemoryRenameSchema = z.object({
  old_key: z.string().min(1),
  new_key: z.string().min(1),
  session: z.string().min(1).optional(),
});

const stdioSession: McpSessionData = {};

const getSessionStore = (context: { session?: McpSessionData }): McpSessionData => {
  return context.session ?? stdioSession;
};

const resolveSession = async (
  preferredSessionKey: string | undefined,
  context: { session?: McpSessionData },
): Promise<{ sessionKey: string; sessionData: SessionValue; refreshed: boolean }> => {
  const sessionStore = getSessionStore(context);
  let sessionKey = preferredSessionKey ?? sessionStore.sessionKey;
  let sessionData = sessionKey
    ? await sessionService.getSession(sessionKey)
    : undefined;
  let refreshed = false;

  if (!sessionKey || !sessionData) {
    sessionKey = await sessionService.generateSession();
    sessionData = (await sessionService.getSession(sessionKey)) ?? {
      last_memory_key: "",
    };
    refreshed = true;
  }

  sessionStore.sessionKey = sessionKey;
  return { sessionKey, sessionData, refreshed };
};

server.addTool({
  name: "session_new",
  description: "Create a new session key",
  parameters: z.object({}),
  execute: async (_args, context) => {
    const sessionKey = await sessionService.generateSession();
    const sessionStore = getSessionStore(context);
    sessionStore.sessionKey = sessionKey;
    return JSON.stringify({ success: true, session: sessionKey }, null, 2);
  },
});

server.addTool({
  name: "memory_add",
  description: "Add a memory record",
  parameters: MemoryAddSchema,
  execute: async (args) => {
    try {
      const value: MemoryNoMeta = {
        ...args.value,
        links: args.value.links ?? [],
        keywords: args.value.keywords ?? [],
      };

      await kvMemoryService.addMemory(args.key, value);

      return JSON.stringify({ success: true, key: args.key }, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return JSON.stringify({ success: false, message }, null, 2);
    }
  },
});

server.addTool({
  name: "memory_get",
  description: "Get a memory record with session-aware traversal",
  parameters: MemoryGetSchema,
  execute: async (args, context) => {
    try {
      const { sessionKey, sessionData, refreshed } = await resolveSession(
        args.session,
        context,
      );

      if (sessionData.last_memory_key) {
        await kvMemoryService.traverseMemory(sessionData.last_memory_key);
      }

      const memory: MemoryNoMetaWithLinkSummary | undefined =
        await kvMemoryService.getMemory(args.key);

      await sessionService.setSession(sessionKey, {
        last_memory_key: args.key,
      });

      return JSON.stringify(
        {
          success: true,
          session: sessionKey,
          session_refreshed: refreshed,
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

server.addTool({
  name: "memory_update",
  description: "Update a memory record",
  parameters: MemoryUpdateSchema,
  execute: async (args, context) => {
    try {
      const { refreshed } = await resolveSession(args.session, context);

      if (args.session && refreshed) {
        return JSON.stringify({ success: false, message: "invalid session" }, null, 2);
      }

      try {
        await kvMemoryService.getMemory(args.key);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        if (message.includes("not found")) {
          return JSON.stringify({ success: false, message: "memory not found" }, null, 2);
        }
        throw error;
      }

      await kvMemoryService.updateMemory(args.key, args.value);

      return JSON.stringify({ success: true, key: args.key }, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return JSON.stringify({ success: false, message }, null, 2);
    }
  },
});

server.addTool({
  name: "memory_rename",
  description: "Rename a memory key",
  parameters: MemoryRenameSchema,
  execute: async (args, context) => {
    try {
      const { refreshed } = await resolveSession(args.session, context);

      if (args.session && refreshed) {
        return JSON.stringify({ success: false, message: "invalid session" }, null, 2);
      }

      if (args.old_key === args.new_key) {
        return JSON.stringify(
          { success: false, message: "old_key and new_key must be different" },
          null,
          2,
        );
      }

      try {
        await kvMemoryService.getMemory(args.old_key);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        if (message.includes("not found")) {
          return JSON.stringify({ success: false, message: "memory not found" }, null, 2);
        }
        throw error;
      }

      try {
        await kvMemoryService.getMemory(args.new_key);
        return JSON.stringify({ success: false, message: "key already exists" }, null, 2);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        if (!message.includes("not found")) {
          throw error;
        }
      }

      await kvMemoryService.updateKey(args.old_key, args.new_key);

      return JSON.stringify(
        { success: true, old_key: args.old_key, new_key: args.new_key },
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
  uriTemplate: "memory://{key}",
  name: "KVDB Memory",
  description: "Read-only access to memory records",
  mimeType: "application/json",
  arguments: [
    {
      name: "key",
      description: "Memory key",
      required: true,
    },
  ],
  load: async (args) => {
    try {
      const memory: MemoryNoMetaWithLinkSummary | undefined =
        await kvMemoryService.getMemory(args.key);
      return {
        uri: `memory://${args.key}`,
        text: JSON.stringify(memory, null, 2),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return {
        uri: `memory://${args.key}`,
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

export const mcpServer = server;

export const startMcpServer = async () => {
  const transport = (Bun.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
  const port = Number(Bun.env.MCP_PORT ?? "8787");
  const host = Bun.env.MCP_HOST;
  const endpoint = (Bun.env.MCP_ENDPOINT ?? "/mcp") as `/${string}`;

  if (transport === "httpstream" || transport === "http" || transport === "sse") {
    await server.start({
      transportType: "httpStream",
      httpStream: {
        port,
        host,
        endpoint,
      },
    });
    return;
  }

  await server.start({
    transportType: "stdio",
  });
};

if (import.meta.main) {
  startMcpServer().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("Failed to start MCP server:", message);
  });
}
