/**
 * KV Servcice
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */
import {z} from 'zod'
import { KVMemory } from '../libs/kv';
import { Optional, KVValue } from '../type';
import { type MemoryNoMeta} from '../type'


export class KVMemoryService {

  async addMemory(key: string, arg: MemoryNoMeta ) {
    await KVMemory.getInstance().add(key, arg)
  }

  async getMemory(key: string) {
    console.log("Get Memory Key,", key)
    const value = await KVMemory.getInstance().get(key);
    if (!value) {
      throw new Error(`KVMemory: get: key ${key} not found`)
    }

    const meta = value.meta;

    meta.access_count += 1;
    meta.last_accessed_at = Date.now();
    await KVMemory.getInstance().setMeta(key, meta)

    return value
  }

  /**
   * 更新记忆
   * @param key 记忆的key
   * @param arg 记忆的value
   * @description 用户手动更新记忆内容
   */
  async updateMemory(key: string, arg: Optional<KVValue, "keywords" | "links">) {


    await KVMemory.getInstance().update(key, arg)
  }

  async traverseMemory(key: string) {
    const value = await KVMemory.getInstance().get(key);
    if (!value) {
      // throw new Error(`KVMemory: traverse: key ${key} not found`)
      return undefined
    }

    const meta = value.meta;

    meta.traverse_count += 1;
    meta.last_linked_at = Date.now();
    await KVMemory.getInstance().setMeta(key, meta)

    return value
  }
}
