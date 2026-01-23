/**
 * Session Service
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { Keyv } from "keyv";
import type { SessionValue } from "../type";

export class SessionService {
  private sessionKeyv;

  constructor() {
    this.sessionKeyv = new Keyv<SessionValue>({ ttl: 180000 });
  }

  /**
   * 生成session
   * @instance
   * @function
   * @returns session {string} session字符串
   * @description 匿名获取session,每个session有效时间为3分钟
   *              session失效后需要重新获取
   */
  async generateSession() {
    const key = Bun.CryptoHasher.hash("md5", Date.now().toString()).toHex();
    await this.sessionKeyv.set(key, { last_accessed_key: '' });
    return key;
  }

  /**
    * 获取session
    * @instance
    * @function
    * @param key {string} 用于查询的session key
    * @returns {SessionValue | undefined} session中保存的信息,也有可能session已经失效
    */
  async getSession(key: string): Promise<SessionValue | undefined> {
    const value = await this.sessionKeyv.get(key);
    return value;
  }

  /**
   * 设置session
   * @instance
   * @function
   * @param key {string} 用于查询的session key
   * @param value {SessionValue} 要保存到session中的信息
   */
  async setSession(key: string, value: SessionValue) {
    await this.sessionKeyv.set(key, value);
  }
}
