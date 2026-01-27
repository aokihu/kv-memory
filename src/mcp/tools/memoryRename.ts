import { encode } from "@toon-format/toon";
import { type Tool } from "fastmcp";
import { KVMemoryService, SessionService } from "../../service";
import {
  MemoryRenameSchema,
  type MemoryRenameInput,
} from "../schemas/memory";

type McpSessionAuth = Record<string, unknown> | undefined;

export const createMemoryRenameTool = (
  sessionService: SessionService,
  kvMemoryService: KVMemoryService
): Tool<McpSessionAuth, typeof MemoryRenameSchema> => ({
  name: "memory_rename",
  description: "Rename a memory key",
  parameters: MemoryRenameSchema,
  execute: async (args: MemoryRenameInput) => {
    try {
      let namespace = "mem";
      if (args.session) {
        const sessionData = await sessionService.getSession(args.session);
        if (!sessionData) {
          return JSON.stringify({ success: false, message: "invalid session" }, null, 2);
        }
        namespace = sessionData.kv_namespace;
      }

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

      const outputFormat = args.output_format ?? "toon";
      const payload = {
        success: true,
        data: { old_key: args.old_key, new_key: args.new_key },
      };

      if (outputFormat === "toon") {
        return encode(payload);
      }

      return JSON.stringify(payload, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return JSON.stringify({ success: false, message }, null, 2);
    }
  },
});
