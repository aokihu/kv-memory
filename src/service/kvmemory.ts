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


export class KVMemoryService {

  async addMemory(key: string, arg: MemoryNoMeta ) {
    await KVMemory.getInstance().add(key, arg)
  }

  async getMemory(key: string): Promise<Memory | undefined> {
    console.log("Get Memory Key,", key)
    const value = await KVMemory.getInstance().get(key);
    if (!value) {
      throw new Error(`KVMemory: get: key ${key} not found`)
    }

    const memory = value as Memory
    const meta: MemoryMeta = memory.meta

    meta.access_count += 1;
    meta.last_accessed_at = Date.now();
    await KVMemory.getInstance().setMeta(key, meta)

    return {
      ...memory,
      meta,
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
