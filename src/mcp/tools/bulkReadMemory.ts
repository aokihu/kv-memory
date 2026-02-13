import { encode } from "@toon-format/toon";
import { type Tool } from "fastmcp";
import { KVMemoryService, SessionService } from "../../service";
import { BulkReadMemorySchema, type BulkReadMemoryInput } from "../schemas/bulkReadMemory";

type McpSessionAuth = Record<string, unknown> | undefined;

export const createBulkReadMemoryTool = (
  sessionService: SessionService,
  kvMemoryService: KVMemoryService,
): Tool<McpSessionAuth, typeof BulkReadMemorySchema> => ({
  name: "bulk_read_memory",
  description: `Batch read memory records with graph traversal, supporting deep traversal of linked memories
Using ':' as the separator for keys
If you don't know what the key is, you can try using {namespace}:index as an attempt
If namespace is in English, use the first letter uppercase format`,
  parameters: BulkReadMemorySchema,
  execute: async (args: BulkReadMemoryInput) => {
    try {
      // Session validation
      if (args.session) {
        const sessionData = await sessionService.getSession(args.session);
        if (!sessionData) {
          return JSON.stringify(
            { success: false, message: "invalid session" },
            null,
            2,
          );
        }
      }

      // Perform bulk read memory
      const result = await kvMemoryService.bulkReadMemory(args.key, {
        depth: args.depth,
        breadth: args.breadth,
        total: args.total,
      });

      if (!result) {
        return JSON.stringify(
          { success: false, message: "memory not found" },
          null,
          2,
        );
      }

      // Update session with last memory key
      if (args.session) {
        await sessionService.setSession(args.session, {
          last_memory_key: args.key,
        });
      }

      // Format output
      const outputFormat = args.output_format ?? "toon";
      const payload = {
        success: true,
        data: {
          targetMemory: result.targetMemory,
          associatedMemories: result.associatedMemories,
          metadata: result.metadata,
        },
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
