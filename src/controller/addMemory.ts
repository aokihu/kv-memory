/**
 * 添加记忆
 * @param key {string} 记忆的key
 * @param arg {Optional<KVValue, "keywords" | "links">} 记忆的value
 */

import type { Optional, KVValue, AppServerContext } from "../type";


type RequestBody = {
    key: string,
    value: Optional<KVValue, "keywords" | "links">,
}

export const addMemoryController = async (req: Bun.BunRequest<"/login">, ctx: AppServerContext) => {

    // 获取提交的key和value
    const { key, value } = req.body as unknown as RequestBody;

    // 调用服务层添加记忆
    ctx.kvMemoryService.addMemory(key, value);

    return Response.json({success: true});
}