/**
 * KV 模块实现
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import Keyv from "keyv";
import { KVStatusEnums, type KVValue, type Optional } from "../../type";
import { KeyvSqlite } from '@keyv/sqlite'

export class KVMemory {
  static instance: KVMemory;
  private _kv: Keyv;

  constructor() {
    this._kv = new Keyv<KVValue>(new KeyvSqlite({ uri: 'sqlite://kv.db' }), { ttl: 180000 })
  }

  static getInstance(): KVMemory {
    if (!KVMemory.instance) {
      KVMemory.instance = new KVMemory();
    }
    return KVMemory.instance;
  }

  async add(key: string, arg: Optional<KVValue, "keywords" | "links">) {
    const now = Date.now();

    // 初始化元数据
    const meta = {
      id: key,
      created_at: now,
      last_accessed_at: now,
      last_linked_at: now,
      in_degree: 0,
      out_degree: 0,
      access_count: 0,
      traverse_count: 0,
      status: KVStatusEnums.ACTIVE,
    }

    const memory = { ...arg, meta };

    await this._kv.set(key, memory)
  }

  async get(key: string):Promise<KVValue | undefined> {
    return await this._kv.get(key)
  }

  async setMeta(key: string, meta: KVValue["meta"]) {
    const value = await this._kv.get(key)
    if (!value) {
      throw new Error(`KVMemory: setMeta: key ${key} not found`)
    }
    await this._kv.set(key, { ...value, meta })
  }

  async update(key:string, arg: Optional<KVValue, keyof KVValue>) {
    const value = await this._kv.get(key)
    if (!value) {
      throw new Error(`KVMemory: update: key ${key} not found`)
    }
    await this._kv.set(key, { ...value, ...arg })
  }

  async updateKey(oldKey: string, newKey: string) {
    const value = await this._kv.get(oldKey)
    if (!value) {
      throw new Error(`KVMemory: updateKey: key ${oldKey} not found`)
    }
    await this._kv.set(newKey, value)
    await this._kv.delete(oldKey)
  }
}