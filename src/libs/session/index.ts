/**
 * Session 会话服务
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 * @description 会话服务，用于管理用户会话
 */

import Keyv from "keyv";
import { type SessionValue, SessionValueSchema } from "../../type";

const NAMESPACE = "_session_";
const TTL = 1000 * 60 * 5; // 5分钟

export class Session {

    private _kv: Keyv<SessionValue>;

    constructor() {
        this._kv = new Keyv<SessionValue>({ namespace: NAMESPACE, ttl: TTL })
    }

    async addSession(sessionId: string, data: SessionValue): Promise<void> {
        const result = SessionValueSchema.safeParse(data)
        if (!result.success) {
            throw new Error(result.error.message)
        }
        await this._kv.set(sessionId, result.data);
    }

    async getSession(sessionId: string): Promise<SessionValue | undefined> {
        return await this._kv.get(sessionId);
    }

    async updateSession(sessionId: string, data: Partial<SessionValue>): Promise<void> {

        const origin = await this.getSession(sessionId);
        if (!origin) {
            throw new Error("session not found")
        }

        const result = SessionValueSchema.partial().safeParse(data)
        if (!result.success) {
            throw new Error(result.error.message)
        }
        await this._kv.set(sessionId, { ...origin, ...result.data });
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this._kv.delete(sessionId);
    }

}