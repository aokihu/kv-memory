/**
 * KVDB Memory types
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import * as z from "zod";

export const KVDomain = z
  .enum(["ui"])
  .describe("记忆所属的高层领域，用于隔离与分组");

export const KVNodeStatus = z
  .enum(["active", "cold", "deprecated", "deleted"])
  .describe("记忆节点的生命周期状态，由系统自动维护");

export const KVType = z
  .enum([
    "decision",
    "constraint",
    "bug",
    "design",
    "assumption",
    "experiment",
    "deprecated",
  ])
  .describe("记忆的语义类型，不同类型影响记忆的保留与代谢策略");

export const KVLinkType = z
  .enum(["constrained_by"])
  .describe("记忆节点之间的关系类型，表达显式的语义或因果关联");

export const KVLink = z.object({
  key: z.string().describe("指向的目标记忆节点 Key"),
  type: KVLinkType,

  created_at: z.number().describe("该连接创建的时间戳"),

  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("连接关系的置信度，用于机器计算权重，不代表人工价值判断"),

  last_traversed_at: z
    .number()
    .optional()
    .describe("该连接最近一次被用于查询或联想路径的时间"),

  traverse_count: z
    .number()
    .default(0)
    .describe("该连接被作为查询路径使用的累计次数"),
});

export const KVNodeKeyword = z.object({
  term: z.string().describe("用于索引与搜索的关键词或术语"),
  weight: z
    .number()
    .min(0)
    .max(1)
    .default(0.5)
    .describe("关键词的相对权重，用于搜索排序与匹配强度计算"),
});

export const KVNodeMeta = z.object({
  id: z.string().uuid().describe("记忆节点的内部唯一ID"),
  created_at: z.number().describe("记忆节点创建的时间戳"),
  last_accessed_at: z.number().describe("该记忆节点最近一次被直接访问的时间"),
  last_linked_at: z
    .number()
    .describe("该记忆节点最近一次通过其他节点连接被访问的时间"),
  access_count: z.number().default(0).describe("记忆节点被直接访问的累计次数"),
  traverse_count: z
    .number()
    .default(0)
    .describe("记忆节点作为连接路径被经过的累计次数"),
  in_degree: z.number().default(0).describe("指向该记忆节点的连接数量"),
  out_degree: z
    .number()
    .default(0)
    .describe("该记忆节点指向其他节点的连接数量"),
  status: KVNodeStatus,
});

export const KVNode = z.object({
  meta: KVNodeMeta.describe("记忆节点的运行态与统计信息，仅由系统维护"),

  summary: z
    .string()
    .max(120)
    .describe("记忆的简要摘要，用于快速理解和搜索结果展示"),

  keywords: z.array(KVNodeKeyword).describe("用于索引和检索的关键词集合"),

  domain: KVDomain,

  type: KVType,

  text: z
    .string()
    .describe("记忆的详细内容，建议使用 Markdown 格式，作为事实与历史记录"),

  links: z.array(KVLink).describe("与该记忆节点存在显式关联的其他记忆节点连接"),
});

/*
 * @Export Type Defintions
 */
export type KVValue = z.infer<typeof KVNode>;
export type KVMeta = z.infer<typeof KVNodeMeta>;
export type KVLink = z.infer<typeof KVLink>;
export type KVKeyword = z.infer<typeof KVNodeKeyword>;
