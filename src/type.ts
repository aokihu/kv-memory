/**
 * KVDB Memory types
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { KVMemoryService } from "./service/kvmemory";
import { SessionService } from "./service/session";

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>


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