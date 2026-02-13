/**
 * MCP Search Schemas
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 * @summary 为 memory_search 与 memory_fulltext_search 提供统一参数和响应校验模型
 */

import { z } from "zod";
import { MemoryLink } from "../../type";
import { SortLinksSchema } from "./common";

/**
 * 基础关键词搜索参数。
 *
 * 用于 `memory_search` 工具，输入与搜索服务 `search(query, limit, offset)` 一致。
 * Debug hint: 当搜索结果持续为空时，先检查 query 是否仅包含空白字符，再检查分页参数是否越界。
 */
export const SearchParamsSchema = z.object({
  query: z.string().trim().min(1).describe("Search query text"),
  limit: z.number().int().min(1).max(100).optional().default(10).describe("Page size (1-100)"),
  offset: z.number().int().min(0).optional().default(0).describe("Pagination offset"),
  sortLinks: SortLinksSchema,
  output_format: z.enum(["json", "toon"]).optional().default("toon"),
});

/**
 * 全文搜索参数。
 *
 * 用于 `memory_fulltext_search` 工具，关键词以逗号分隔字符串输入，
 * 并通过 operator 指定关键词组合关系（AND/OR）。
 * Debug hint: 若业务层报关键词错误，优先检查 keywords 拆分后是否存在非空词项。
 */
export const FulltextSearchParamsSchema = z.object({
  keywords: z
    .string()
    .trim()
    .min(1)
    .describe("Comma-separated keywords, e.g. memory,search,sqlite"),
  operator: z.enum(["AND", "OR"]).optional().default("OR").describe("Keyword operator"),
  limit: z.number().int().min(1).max(100).optional().default(10).describe("Page size (1-100)"),
  offset: z.number().int().min(0).optional().default(0).describe("Pagination offset"),
  sortLinks: SortLinksSchema,
  output_format: z.enum(["json", "toon"]).optional().default("toon"),
});

/**
 * 单条搜索结果结构。
 *
 * 该结构同时覆盖基础搜索与全文搜索返回项：
 * - key: 记忆唯一键
 * - summary: 记忆摘要
 * - excerpt: 高亮片段或正文截断片段
 * - relevance/score: 相关度分值（0~1，值越大越相关）
 * Debug hint: relevance 异常时先检查上游 rank->relevance 转换逻辑。
 */
export const SearchResultSchema = z.object({
  key: z.string().min(1).describe("Memory key"),
  summary: z.string().describe("Memory summary"),
  excerpt: z.string().describe("Highlighted excerpt or text snippet"),
  relevance: z.number().min(0).max(1).describe("Relevance score normalized to 0..1"),
  score: z.number().min(0).max(1).describe("Compatibility score field, same value as relevance"),
  links: z.array(MemoryLink).describe("Memory links for this result"),
});

/**
 * 搜索成功响应结构。
 *
 * 与现有 MCP 工具输出风格保持一致：`success: true` + `data`。
 * data 中包含结果数组与分页对象，便于 Agent 继续做分页读取。
 */
export const SearchResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    results: z.array(SearchResultSchema),
    pagination: z.object({
      total: z.number().int().min(0).describe("Total matched records"),
      limit: z.number().int().min(1).max(100).describe("Current page size"),
      offset: z.number().int().min(0).describe("Current offset"),
    }),
  }),
});

/**
 * 搜索失败响应结构。
 *
 * 与 MCP 现有错误返回对齐：`success: false` + `message`。
 * Debug hint: message 为空时应回溯异常捕获分支，检查 Error 实例化与序列化流程。
 */
export const SearchErrorSchema = z.object({
  success: z.literal(false),
  message: z.string().min(1),
});

export type SearchParamsInput = z.infer<typeof SearchParamsSchema>;
export type FulltextSearchParamsInput = z.infer<typeof FulltextSearchParamsSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type SearchError = z.infer<typeof SearchErrorSchema>;
