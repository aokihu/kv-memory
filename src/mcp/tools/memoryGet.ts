import { type Tool } from "fastmcp";
import { KVMemoryService, SessionService } from "../../service";
import type { MemoryNoMetaWithLinkSummary } from "../../service/kvmemory";
import {
  MemoryGetSchema,
  type MemoryGetInput,
} from "../schemas/memory";

type McpSessionAuth = Record<string, unknown> | undefined;

export const createMemoryGetTool = (
  sessionService: SessionService,
  kvMemoryService: KVMemoryService
): Tool<McpSessionAuth, typeof MemoryGetSchema> => ({
  name: "memory_get",
  description: "Get a memory record with session-aware traversal",
  parameters: MemoryGetSchema,
  execute: async (args: MemoryGetInput) => {
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
