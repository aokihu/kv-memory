/**
 * MCP Tool: memory_search
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { encode } from "@toon-format/toon";
import { type Tool } from "fastmcp";
import { z } from "zod";
import { KVMemoryService, SessionService } from "../../service";
import { SearchParamsSchema, type SearchParamsInput } from "../schemas/search";

type McpSessionAuth = Record<string, unknown> | undefined;

const MemorySearchSchema = SearchParamsSchema.extend({
  session: z.string().min(1).describe("Required session ID for namespace filtering"),
});

type MemorySearchInput = SearchParamsInput & { session: string };

export const createMemorySearchTool = (
  sessionService: SessionService,
  kvMemoryService: KVMemoryService,
): Tool<McpSessionAuth, typeof MemorySearchSchema> => ({
  name: "memory_search",
  description: "Search memories by query with pagination",
  parameters: MemorySearchSchema,
  execute: async (args: MemorySearchInput) => {
    try {
      const sessionData = await sessionService.getSession(args.session);
      if (!sessionData) {
        return JSON.stringify({ success: false, message: "invalid session" }, null, 2);
      }
      const namespace = sessionData.kv_namespace;

      const result = await kvMemoryService.searchMemory(
        args.query,
        args.limit,
        args.offset,
        namespace,
        args.sortLinks,
      );

      const payload = { success: true, data: result };
      if (args.output_format === "toon") {
        return encode(payload);
      }

      return JSON.stringify(payload, null, 2);
    } catch (error) {
      console.error("memory_search failed", error);
      const message = error instanceof Error ? error.message : "unknown error";
      return JSON.stringify({ success: false, message }, null, 2);
    }
  },
});
