import { encode } from "@toon-format/toon";
import { type Tool } from "fastmcp";
import { KVMemoryService, SessionService } from "../../service";
import type { MemoryNoMeta } from "../../type";
import {
  MemoryAddSchema,
  type MemoryAddInput,
} from "../schemas/memory";

type McpSessionAuth = Record<string, unknown> | undefined;

export const createMemoryAddTool = (
  sessionService: SessionService,
  kvMemoryService: KVMemoryService
): Tool<McpSessionAuth, typeof MemoryAddSchema> => ({
  name: "memory_add",
  description: "Add a memory record",
  parameters: MemoryAddSchema,
  execute: async (args: MemoryAddInput) => {
    try {
      let namespace = "mem";
      if (args.session) {
        const sessionData = await sessionService.getSession(args.session);
        if (!sessionData) {
          return JSON.stringify({ success: false, message: "invalid session" }, null, 2);
        }
        namespace = sessionData.kv_namespace;
      }
      const value: MemoryNoMeta = {
        ...args.value,
        links: args.value.links ?? [],
        keywords: args.value.keywords ?? [],
      };

      await kvMemoryService.addMemory(namespace, args.key, value);

      const outputFormat = args.output_format ?? "toon";
      const payload = { success: true };

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
