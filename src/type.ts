/**
 * KVDB Memory types
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { z } from 'zod';
import { KVMemoryService } from "./service/kvmemory";
import { SessionService } from "./service/session";

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

export const MemoryStatusEnums = z.enum(["active", "cold", "deprecated", "deleted"]).default("active");
export const MemoryLinkTypeEnums = z.enum(["decision", "constrained", "bug", "design", "assumption", "experiment"]);

export const MemoryLink = z.object({
  type: MemoryLinkTypeEnums,
  term: z.string(),
  weight: z.number().min(0).max(1).default(0.5)
})


export const MemoryMetaSchma = z.object({
  id: z.string(),
  created_at: z.number(), // 创建时间
  last_accessed_at: z.number(), // 最后访问时间
  last_linked_at: z.number(), // 最后链接时间
  in_degree: z.number(), // 入度
  out_degree: z.number(), // 出度
  access_count: z.number(), // 访问次数
  traverse_count: z.number(), // 遍历次数
  status: MemoryStatusEnums // 状态
})

export const MemorySchema = z.object({
  meta: z.any(),
  domain: z.string(),
  summary: z.string(),
  text: z.string(),
  type: z.string(),
  links: z.array(MemoryLink),
  keywords: z.array(z.string()),
})

export const MemoryNoMetaSchema = MemorySchema.omit({"meta": true})

export type MemoryNoMeta = z.infer<typeof MemoryNoMetaSchema>

export const KVDomainEnums = {}
export const KVStatusEnums = {
  ACTIVE: "active",
  COLD: "cold",
  DEPRECATED: "deprecated",
  DELETED: "deleted",
} as const;

export const KVLinkTypeEnums = {
  DECISION: "decision",
  CONSTRAINT: "constrained",
  BUG: "bug",
  DESIGN: "design",
  ASSUMPTION: "assumption",
  EXPERIMENT: "experiment",
  DEPRECATED: "deprecated",
}

export type KVMeta = {
  id: string; // 内存ID
  created_at: number; // 创建时间
  last_accessed_at: number; // 最后访问时间
  last_linked_at: number; // 最后链接时间
  in_degree: number; // 入度
  out_degree: number; // 出度
  access_count: number; // 访问次数
  traverse_count: number; // 遍历次数
  status: (typeof KVStatusEnums)[keyof typeof KVStatusEnums]; // 状态
}

export type KVValue = {
  meta: KVMeta;
  domain: string; // 域名
  summary: string; // 摘要
  text: string; // 文本
  type: string; // 类型
  links: string[]; // 链接
  keywords: string[]; // 关键词
}

export type KVLink = {
  type: (typeof KVLinkTypeEnums)[keyof typeof KVLinkTypeEnums]; // 链接类型
  term: string; // 链接的术语
  weight: number; // 链接的权重, 范围[0,1],默认0.5
}


/* ----- App ----- */

export type AppServerContext = {
  sessionService: SessionService;
  kvMemoryService: KVMemoryService;
}


/* ---- Session ---- */

export type SessionValue = {
  last_memory_key: string; // 最后访问的记忆key
}