/**
 * Session Service
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { Keyv } from "keyv";
import { Session } from '../libs/session'
import type { SessionValue } from "../type";

export class SessionService {

  private _session: Session;

  constructor() {
    this._session = new Session();
  }

  /**
   * 生成session
   * @instance
   * @function
   * @returns session {string} session字符串
   * @description 匿名获取session,每个session有效时间为3分钟
   *              session失效后需要重新获取
   */
  async generateSession(namespace: string = 'mem'): Promise<string> {
    const key = Bun.CryptoHasher.hash("md5", Date.now().toString()).toHex();
    await this._session.addSession(key, { kv_namespace: namespace, last_memory_key: '' });
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
    const value = await this._session.getSession(key);
    return value;
  }

  /**
   * 设置session
   * @instance
   * @function
   * @param key {string} 用于查询的session key
   * @param value {SessionValue} 要保存到session中的信息
   */
  async setSession(key: string, value: Partial<SessionValue>) {
    await this._session.updateSession(key, value);
  }
}
