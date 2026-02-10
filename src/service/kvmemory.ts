/**
 * KV Servcice
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */
import { KVMemory } from '../libs/kv';
import {
  type Memory,
  type MemoryMeta,
  type MemoryNoMeta,
} from '../type'

export type MemoryLinkWithSummary = Memory['links'][number] & {
  summary: string;
}

export type MemoryNoMetaWithLinkSummary = Omit<Memory, 'meta' | 'links'> & {
  links: MemoryLinkWithSummary[];
}


export class KVMemoryService { 
  private _kvCollect: Map<string, KVMemory> = new Map();

  constructor() {
    this._kvCollect.set('mem', new KVMemory()); // 初始化时候创建一个默认的记忆命名空间
  }

  addKVMemory(namespace: string) {
    this._kvCollect.set(namespace, new KVMemory());
  }

  /**
   * 添加记忆
   * @param namespace 记忆命名空间
   * @param key 记忆的key
   * @param arg 记忆的value
   * @description 增加访问次数和最后访问时间
   */
  async addMemory(namespace: string, key: string, arg: MemoryNoMeta ) {
    if(!this._kvCollect.has(namespace)) {
      this.addKVMemory(namespace);
    }

    await this._kvCollect.get(namespace)?.add(key, arg)
  }

  /**
   * 获取记忆
   * @param namespace 记忆命名空间
   * @param key 记忆的key
   * @returns 记忆的value
   * @description 增加访问次数和最后访问时间
   */
  async getMemory(namespace: string, key: string): Promise<MemoryNoMetaWithLinkSummary | undefined> {
    const kv = this._kvCollect.get(namespace);
    if (!kv) {
      return undefined
    }
    const value = await kv.get(key);
    if (!value) {
      return undefined
    }

    const memory = value as Memory
    const meta: MemoryMeta = memory.meta

    meta.access_count += 1;
    meta.last_accessed_at = Date.now();
    await kv.setMeta(key, meta)

    const { meta: _meta, ...baseMemory } = memory

    if (!memory.links || memory.links.length === 0) {
      return {
        ...baseMemory,
        links: [],
      }
    }

    try {
      const links = await Promise.all(
        memory.links.map(async (link) => {
          const linkedValue = await kv.get(link.key! as string);
          if (!linkedValue) {
            return {
              ...link,
              summary: '关联记忆不存在',
            }
          }

          const linkedMemory = linkedValue as Memory
          return {
            ...link,
            summary: linkedMemory.summary ?? '关联记忆不存在',
          }
        })
      )

      return {
        ...baseMemory,
        links,
      }
    } catch {
      return {
        ...baseMemory,
        links: memory.links.map((link) => ({
          ...link,
          summary: '关联记忆不存在',
        })),
      }
    }
  }

  /**
   * 更新记忆
   * @param namespace 记忆命名空间
   * @param key 记忆的key
   * @param arg 记忆的value
   * @description 用户手动更新记忆内容
   */
  async updateMemory(namespace: string, key: string, arg: Partial<MemoryNoMeta>) {
    await this._kvCollect.get(namespace)?.update(key, arg)
  }

  /**
   * 更新记忆的key
   * @param namespace 记忆命名空间
   * @param oldKey 旧的记忆key
   * @param newKey 新的记忆key
   */
  async updateKey(namespace: string, oldKey: string, newKey: string) {
    await this._kvCollect.get(namespace)?.updateKey(oldKey, newKey)
  }

  /**
   * 遍历记忆
   * @param namespace 记忆命名空间
   * @param key 记忆的key
   * @returns 记忆的value
   * @description 增加遍历次数和最后遍历时间
   */
  async traverseMemory(namespace: string, key: string): Promise<Memory | undefined> {
    const kv = this._kvCollect.get(namespace);
    if (!kv) {
      return undefined
    }
    const value = await kv.get(key);
    if (!value) {
      // throw new Error(`KVMemory: traverse: key ${key} not found`)
      return undefined
    }

    const memory = value as Memory
    const meta: MemoryMeta = memory.meta

    meta.traverse_count += 1;
    meta.last_linked_at = Date.now();
    await kv.setMeta(key, meta)

    return {
      ...memory,
      meta,
    }
  }
}
