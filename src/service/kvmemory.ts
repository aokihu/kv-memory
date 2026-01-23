/**
 * KV Servcice
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { KVMemory } from '../libs/kv';
import { Optional, KVValue } from '../type';

export class KVMemoryService {

  async addMemory(key: string, arg: Optional<KVValue, "keywords" | "links">) {
    await KVMemory.getInstance().add(key, arg)
  }

  async getMemory(key: string) {
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

  async traverseMemory(key: string) {
    const value = await KVMemory.getInstance().get(key);
    if (!value) {
      throw new Error(`KVMemory: traverse: key ${key} not found`)
    }

    const meta = value.meta;

    meta.traverse_count += 1;
    meta.last_linked_at = Date.now();
    await KVMemory.getInstance().setMeta(key, meta)

    return value
  }
}
