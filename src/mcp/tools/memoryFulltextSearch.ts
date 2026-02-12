/**
 * MCP Tool: memory_fulltext_search
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { encode } from "@toon-format/toon";
import { type Tool } from "fastmcp";
import { z } from "zod";
import { KVMemoryService, SessionService } from "../../service";

type McpSessionAuth = Record<string, unknown> | undefined;

const MemoryFulltextSearchSchema = z.object({
  keywords: z
    .string()
    .trim()
    .min(1)
    .describe("Comma-separated keywords, e.g. memory,search,sqlite"),
  operator: z.enum(["AND", "OR"]).optional().default("OR").describe("Keyword operator"),
  session: z.string().min(1).describe("Required session ID for namespace filtering"),
  limit: z.number().int().min(1).max(100).optional().default(10).describe("Page size (1-100)"),
  offset: z.number().int().min(0).optional().default(0).describe("Pagination offset"),
  output_format: z.enum(["json", "toon"]).optional().default("toon"),
});

type MemoryFulltextSearchInput = z.infer<typeof MemoryFulltextSearchSchema>;

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
