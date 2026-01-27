/**
 * 更新记忆key控制器
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 * @description 记忆key重命名
 */
import { z } from 'zod'
import { type AppServerContext } from '../type'

const RequestBodySchema = z.object({
    session: z.string(),
    old_key: z.string(),
    new_key: z.string(),
})

type RequestBody = z.infer<typeof RequestBodySchema>

export const updateMemoryKeyController = async (req: Bun.BunRequest<"/update_memory_key">, ctx: AppServerContext) => {
    let body: RequestBody;
    try {
        body = await req.json() as RequestBody;
    } catch {
        return Response.json({ success: false, message: "invalid json" }, { status: 400 });
    }

    // 检查请求体
    const result = RequestBodySchema.safeParse(body);

    if (result.error) {
        return Response.json({ success: false, message: result.error.issues }, { status: 400 });
    }

    const { session, old_key, new_key } = result.data;

    // 验证session
    const sessionData = await ctx.sessionService.getSession(session);
    if (!sessionData) {
        return Response.json({
            success: false,
            message: "invalid session",
        });
    }

    const ns = sessionData.kv_namespace;

    if (old_key === new_key) {
        return Response.json({
            success: false,
            message: "old_key and new_key must be different",
        });
    }

    // 检查旧key是否存在
    const oldMemory = await ctx.kvMemoryService.getMemory(ns, old_key);
    if (!oldMemory) {
        return Response.json({
            success: false,
            message: "memory not found",
        });
    }

    // 检查新key是否存在
    const newMemory = await ctx.kvMemoryService.getMemory(ns, new_key);
    if (newMemory) {
        return Response.json({
            success: false,
            message: "key already exists",
        });
    }

    await ctx.kvMemoryService.updateKey(ns, old_key, new_key);

    return Response.json({
        success: true,
        data: {
            old_key,
            new_key,
        },
    });
}
