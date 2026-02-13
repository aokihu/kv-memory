import { encode } from "@toon-format/toon";
import { type Tool } from "fastmcp";
import { KVMemoryService, SessionService } from "../../service";
import type { MemoryNoMetaWithLinkSummary } from "../../service/kvmemory";
import { MemoryGetSchema, type MemoryGetInput } from "../schemas/memory";

type McpSessionAuth = Record<string, unknown> | undefined;

export const createMemoryGetTool = (
  sessionService: SessionService,
  kvMemoryService: KVMemoryService,
): Tool<McpSessionAuth, typeof MemoryGetSchema> => ({
  name: "memory_get",
  description: `Get a memory record with session-aware traversal,使用':'作为key的分隔符
    如果不知道key是什么,可以使用{namespace}:index作为尝试
    namespace如果是英文,使用首字母大写格式`,
  parameters: MemoryGetSchema,
  execute: async (args: MemoryGetInput) => {
    try {
      let lastMemoryKey = "";
      if (args.session) {
        const sessionData = await sessionService.getSession(args.session);
        if (!sessionData) {
          return JSON.stringify(
            { success: false, message: "invalid session" },
            null,
            2,
          );
        }
        lastMemoryKey = sessionData.last_memory_key;
      }

      if (lastMemoryKey !== "") {
        await kvMemoryService.traverseMemory(lastMemoryKey);
      }

      const memory: MemoryNoMetaWithLinkSummary | undefined =
        await kvMemoryService.getMemory(args.key, args.sortLinks);

      if (!memory) {
        return JSON.stringify(
          { success: false, message: "memory not found" },
          null,
          2,
        );
      }

      if (args.session) {
        await sessionService.setSession(args.session, {
          last_memory_key: args.key,
        });
      }

      const outputFormat = args.output_format ?? "toon";
      const payload = { success: true, data: memory };

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
