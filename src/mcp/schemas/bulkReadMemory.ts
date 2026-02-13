import { z } from "zod";
import { SortLinksSchema } from "./common";

/**
 * Bulk Read Memory Schema
 * For batch reading memory with graph traversal
 */
export const BulkReadMemorySchema = z.object({
  key: z.string().min(1, { message: "key is required" }),
  session: z.string().min(1).optional(),
  depth: z.coerce.number().int().min(1).max(6).optional().default(3),
  breadth: z.coerce.number().int().min(1).max(20).optional().default(5),
  total: z.coerce.number().int().min(1).max(50).optional().default(20),
  sortLinks: SortLinksSchema,
  output_format: z.enum(["json", "toon"]).default("toon"),
});

export type BulkReadMemoryInput = z.infer<typeof BulkReadMemorySchema>;
