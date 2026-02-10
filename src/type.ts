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
  key: z.string().optional(),
  term: z.string(),
  weight: z.number().min(0).max(1).default(0.5)
})


export const MemoryMetaSchema = z.object({
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

export const MemoryMetaSchma = MemoryMetaSchema

export const MemorySchema = z.object({
  meta: MemoryMetaSchema,
  summary: z.string(),
  text: z.string(),
  links: z.array(MemoryLink),
})

export const MemoryNoMetaSchema = MemorySchema.omit({"meta": true})

export type MemoryMeta = z.infer<typeof MemoryMetaSchema>
export type Memory = z.infer<typeof MemorySchema>
export type MemoryNoMeta = z.infer<typeof MemoryNoMetaSchema>


/* ----- App ----- */

export type AppServerContext = {
  sessionService: SessionService;
  kvMemoryService: KVMemoryService;
}


/* ---- Session ---- */


export const SessionValueSchema = z.object({
  kv_namespace: z.string().describe("会话的kv namespace"),
  last_memory_key: z.string().describe("最后访问的记忆key"),
})

export type SessionValue = z.infer<typeof SessionValueSchema>
