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

  async addMemory(key: string, arg: MemoryNoMeta ) {
    await KVMemory.getInstance().add(key, arg)
  }

  async getMemory(key: string): Promise<MemoryNoMetaWithLinkSummary | undefined> {
    const value = await KVMemory.getInstance().get(key);
    if (!value) {
      return undefined
    }

    const memory = value as Memory
    const meta: MemoryMeta = memory.meta

    meta.access_count += 1;
    meta.last_accessed_at = Date.now();
    await KVMemory.getInstance().setMeta(key, meta)

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
          const linkedValue = await KVMemory.getInstance().get(link.key);
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
   * @param key 记忆的key
   * @param arg 记忆的value
   * @description 用户手动更新记忆内容
   */
  async updateMemory(key: string, arg: Partial<MemoryNoMeta>) {
    await KVMemory.getInstance().update(key, arg)
  }

  /**
   * 更新记忆的key
   * @param oldKey 旧的记忆key
   * @param newKey 新的记忆key
   */
  async updateKey(oldKey: string, newKey: string) {
    await KVMemory.getInstance().updateKey(oldKey, newKey)
  }

  async traverseMemory(key: string): Promise<Memory | undefined> {
    const value = await KVMemory.getInstance().get(key);
    if (!value) {
      // throw new Error(`KVMemory: traverse: key ${key} not found`)
      return undefined
    }

    const memory = value as Memory
    const meta: MemoryMeta = memory.meta

    meta.traverse_count += 1;
    meta.last_linked_at = Date.now();
    await KVMemory.getInstance().setMeta(key, meta)

    return {
      ...memory,
      meta,
    }
  }
}
