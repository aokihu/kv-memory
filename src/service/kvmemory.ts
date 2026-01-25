/**
 * KV Servcice
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */
import { KVMemory } from '../libs/kv';
import {
  MemoryMetaSchema,
  MemoryNoMetaSchema,
  MemorySchema,
  MemoryStatusEnums,
  type Memory,
  type MemoryMeta,
  type MemoryNoMeta,
} from '../type'


export class KVMemoryService {

  async addMemory(key: string, arg: MemoryNoMeta ) {
    const payload = MemoryNoMetaSchema.parse(arg)
    await KVMemory.getInstance().add(key, payload)
  }

  async getMemory(key: string): Promise<Memory | undefined> {
    console.log("Get Memory Key,", key)
    const value = await KVMemory.getInstance().get(key);
    if (!value) {
      throw new Error(`KVMemory: get: key ${key} not found`)
    }

    const parsed = MemorySchema.parse(value)
    const meta: MemoryMeta = MemoryMetaSchema.parse(parsed.meta)

    meta.access_count += 1;
    meta.last_accessed_at = Date.now();
    await KVMemory.getInstance().setMeta(key, meta)

    return {
      ...parsed,
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
    const payload = MemoryNoMetaSchema.partial().parse(arg)
    await KVMemory.getInstance().update(key, payload)
  }

  async traverseMemory(key: string): Promise<Memory | undefined> {
    const value = await KVMemory.getInstance().get(key);
    if (!value) {
      // throw new Error(`KVMemory: traverse: key ${key} not found`)
      return undefined
    }

    const parsed = MemorySchema.parse(value)
    const meta: MemoryMeta = MemoryMetaSchema.parse(parsed.meta)

    meta.traverse_count += 1;
    meta.last_linked_at = Date.now();
    await KVMemory.getInstance().setMeta(key, meta)

    return {
      ...parsed,
      meta,
    }
  }
}
