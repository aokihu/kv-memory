import { type Tool } from "fastmcp";
import { KVMemoryService, SessionService } from "../../service";
import {
  MemoryUpdateSchema,
  type MemoryUpdateInput,
} from "../schemas/memory";

type McpSessionAuth = Record<string, unknown> | undefined;

export const createMemoryUpdateTool = (
  sessionService: SessionService,
  kvMemoryService: KVMemoryService
): Tool<McpSessionAuth, typeof MemoryUpdateSchema> => ({
  name: "memory_update",
  description: "Update a memory record",
  parameters: MemoryUpdateSchema,
  execute: async (args: MemoryUpdateInput) => {
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
