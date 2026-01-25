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

export const addMemoryController = async (req: Bun.BunRequest<"/add_memory">, ctx: AppServerContext) => {

    let body: RequestBody;
    try {
        body = await req.json();
    } catch {
        return Response.json({ success: false, message: "invalid json" }, { status: 400 });
    }

    const { key, value } = body;

    if (!key || !value) {
        return Response.json({ success: false, message: "missing key or value" }, { status: 400 });
    }

    await ctx.kvMemoryService.addMemory(key, value);

    return Response.json({ success: true });
}
