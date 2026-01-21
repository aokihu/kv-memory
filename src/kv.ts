/**
 * KVDB Memory
 * @author aokihu <aokihu@gmail.com>
 * @module key-value module 键值模块
 * @license MIT
 * @description 使用键值方案存储记忆,这里会引入动态记忆机制,
 *              当记忆变得不再重要的时候会被标记删除
 *
 *              通过计算memory_score来判断记忆的活跃程度，分数越高越活越
 *
 *              ## 计算公式
 *              memory_score = S_structure + S_behavior + S_recency - S_age
 *
 *              ### 结构分值 S_structure
 *              S_structure = A * log(1 + in_degreee) + B * log(1 + out_degree)
 *
 *              ### 行为分值 S_behavior
 *              S_behavior = C * log(1 + access_count) + D * log(1 + traverse_count)
 *
 *              ### 新鲜度分值 S_recency
 *              S_recency = E * exp(-(now - last_accessed_at) / T_access) + F * exp(-(now - last_linked_at) / T_link)
 *
 *              ### 年龄惩罚 S_age
 *              S_age = G * ((now - created_at) / T_age)
 *
 *              ### 参考参数
 *              A = 1.0   // 被依赖的重要性
 *              B = 0.8   // 枢纽性
 *              C = 1.2   // 直接使用
 *              D = 0.8   // 间接使用
 *              E = 1.5   // 近期访问
 *              F = 1.0   // 近期联想
 *              G = 0.3   // 年龄惩罚
 *
 *              T_access = 24h
 *              T_link   = 72h
 *              T_age    = 30d
 */

import { createKeyv } from "@keyv/sqlite";
import type { KVValue, KVMeta, KVLink, KVKeyword } from "./type";

const keyv = createKeyv("sqlite://./kv.db");

type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

interface KVProtocol {
  /* 添加新记忆 */
  addMemory: (
    key: string, arg: OptionalKeys<Omit<KVValue, "meta">, "keywords" | "links">,
  ) => Promise<void>;

  /* 更新记忆 */
  updateMemory: (
    key: string, arg: OptionalKeys<Omit<KVValue, "meta">, "keywords" | "domain" | "links" | "summary" | "text" | "type">,
  ) => Promise<void>;
}

class KV implements KVProtocol {
  async addMemory(
    key: string,
    arg: OptionalKeys<Omit<KVValue, "meta">, "keywords" | "links">,
  ) {
    const meta: KVMeta = {
      id: Bun.randomUUIDv7(),
      created_at: Date.now(),
      last_accessed_at: Date.now(),
      last_linked_at: 0,
      in_degree: 0,
      out_degree: 0,
      access_count: 0,
      traverse_count: 0,
      status: "active",
    };

    const value: KVValue = {
      meta,
      domain: arg.domain,
      summary: arg.summary,
      text: arg.text,
      type: arg.type,
      links: arg.links ?? [],
      keywords: arg.keywords ?? [],
    };

    keyv.set(key, value);

    return;
  }

  async updateMemory(key: string, arg: OptionalKeys<Omit<KVValue, "meta">, "keywords" | "domain" | "links" | "summary" | "text" | "type") {
    const _value = keyv.get(key);

  }
}

export { keyv as kv };
