/**
 * MCP Tool: memory_fulltext_search
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { encode } from "@toon-format/toon";
import { type Tool } from "fastmcp";
import { z } from "zod";
import { KVMemoryService, SessionService } from "../../service";
import {
  FulltextSearchParamsSchema,
  type FulltextSearchParamsInput,
} from "../schemas/search";

type McpSessionAuth = Record<string, unknown> | undefined;

const MemoryFulltextSearchSchema = FulltextSearchParamsSchema.extend({
  session: z.string().min(1).describe("Required session ID for namespace filtering"),
});

type MemoryFulltextSearchInput = FulltextSearchParamsInput & { session: string };

export const createMemoryFulltextSearchTool = (
  sessionService: SessionService,
  kvMemoryService: KVMemoryService,
): Tool<McpSessionAuth, typeof MemoryFulltextSearchSchema> => ({
  name: "memory_fulltext_search",
  description: "Fulltext search memories by keywords with AND/OR operator",
  parameters: MemoryFulltextSearchSchema,
  execute: async (args: MemoryFulltextSearchInput) => {
    try {
      const sessionData = await sessionService.getSession(args.session);
      if (!sessionData) {
        return JSON.stringify({ success: false, message: "invalid session" }, null, 2);
      }
      const namespace = sessionData.kv_namespace;

      const keywordList = args.keywords
        .split(",")
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0);

      if (keywordList.length === 0) {
        return JSON.stringify(
          {
            success: false,
            message: "keywords must contain at least one non-empty value",
          },
          null,
          2,
        );
      }

      const result = await kvMemoryService.fulltextSearchMemory(
        keywordList,
        args.operator,
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
      console.error("memory_fulltext_search failed", error);
      const message = error instanceof Error ? error.message : "unknown error";
      return JSON.stringify({ success: false, message }, null, 2);
    }
  },
});
