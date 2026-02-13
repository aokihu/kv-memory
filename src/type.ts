/**
 * KVDB Memory types
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { z } from "zod";
import { KVMemoryService } from "./service/kvmemory";
import { SessionService } from "./service/session";

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export const MemoryStatusEnums = z
  .enum(["active", "cold", "deprecated", "deleted"])
  .default("active");
export const MemoryLinkTypeEnums = z.enum([
  "decision",
  "constrained",
  "bug",
  "design",
  "assumption",
  "experiment",
]);

export const MemoryLink = z.object({
  type: MemoryLinkTypeEnums,
  key: z.string().optional(),
  term: z.string(),
  weight: z.number().min(0).max(1).default(0.5),
});

export const MemoryMetaSchema = z.object({
  id: z.string(),
  created_at: z.number(), // 创建时间
  last_accessed_at: z.number(), // 最后访问时间
  last_linked_at: z.number(), // 最后链接时间
  in_degree: z.number(), // 入度
  out_degree: z.number(), // 出度
  access_count: z.number(), // 访问次数
  traverse_count: z.number(), // 遍历次数
  version: z.number().int().nonnegative().optional(), // 乐观锁版本号（兼容旧数据）
  score: z.number().min(0).max(100).default(50).optional(), // 记忆分数
  status: MemoryStatusEnums, // 状态
});

export const MemoryMetaSchma = MemoryMetaSchema;

export const MemorySchema = z.object({
  meta: MemoryMetaSchema,
  summary: z.string(),
  text: z.string(),
});

export const MemoryNoMetaSchema = MemorySchema.omit({ meta: true });
export const MemoryWithLinksSchema = MemorySchema.extend({
  links: z.array(MemoryLink).default([]),
});

export const SortLinksInputSchema = z.union([
  z.boolean(),
  z.enum(["true", "false"]),
]);

export type MemoryMeta = z.infer<typeof MemoryMetaSchema> & {
  score?: number;
};
export type Memory = z.infer<typeof MemorySchema>;
export type MemoryNoMeta = z.infer<typeof MemoryNoMetaSchema>;
export type MemoryWithLinks = z.infer<typeof MemoryWithLinksSchema>;
export type MemoryLinkValue = z.infer<typeof MemoryLink>;
export type SortLinksInput = z.infer<typeof SortLinksInputSchema>;
export type SortLinksValue = boolean;

export type McpOutputFormat = "json" | "toon";

export type McpMemoryGetParams = {
  key: string;
  session?: string;
  bulkRead?: boolean | "true" | "false";
  depth?: number;
  breadth?: number;
  total?: number;
  sortLinks?: SortLinksInput;
  output_format?: McpOutputFormat;
};

export type BulkReadMetadata = {
  depthReached: number;
  totalRetrieved: number;
  duplicatesSkipped: number;
};

export type McpMemorySearchParams = {
  query: string;
  session: string;
  limit?: number;
  offset?: number;
  sortLinks?: SortLinksInput;
  output_format?: McpOutputFormat;
};

export type McpMemoryFulltextSearchParams = {
  keywords: string;
  operator?: "AND" | "OR";
  session: string;
  limit?: number;
  offset?: number;
  sortLinks?: SortLinksInput;
  output_format?: McpOutputFormat;
};

export type McpSuccessResponse<T> = {
  success: true;
  data: T;
};

export type McpErrorResponse = {
  success: false;
  message: string;
};

export type McpResponse<T> = McpSuccessResponse<T> | McpErrorResponse;

/* ----- App ----- */

export type AppServerContext = {
  sessionService: SessionService;
  kvMemoryService: KVMemoryService;
};

/* ---- Session ---- */

export const SessionValueSchema = z.object({
  kv_namespace: z.string().describe("会话的kv namespace"),
  last_memory_key: z.string().describe("最后访问的记忆key"),
});

export type SessionValue = z.infer<typeof SessionValueSchema>;
