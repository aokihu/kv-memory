/**
 * 更新记忆控制器
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { AppServerContext, Optional, KVValue } from '../type'

type RequestBody = {
    key: string,
    value: Optional<KVValue, "keywords" | "links">,
}

export const updateMemoryController = async (req: Bun.BunRequest<"/update_memory">, ctx: AppServerContext) => {
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

    await ctx.kvMemoryService.updateMemory(key, value);

    return Response.json({ success: true });
}