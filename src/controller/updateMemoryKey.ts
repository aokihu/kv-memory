/**
 * 更新记忆key控制器
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 * @description 记忆key重命名
 */
import { z } from 'zod'
import { AppServerContext } from '../type'

const RequestBodySchema = z.object({
    session: z.string(),
    old_key: z.string(),
    new_key: z.string(),
})

type RequestBody = z.infer<typeof RequestBodySchema>

export const updateMemoryKeyController = async (req: Bun.BunRequest<"/update_memory_key">, ctx: AppServerContext) => {
    let body: RequestBody;
    try {
        body = await req.json();
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

    if (old_key === new_key) {
        return Response.json({
            success: false,
            message: "old_key and new_key must be different",
        });
    }

    // 检查旧key是否存在
    try {
        await ctx.kvMemoryService.getMemory(old_key);
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        if (message.includes("not found")) {
            return Response.json({
                success: false,
                message: "memory not found",
            });
        }
        throw error;
    }

    // 检查新key是否存在
    try {
        await ctx.kvMemoryService.getMemory(new_key);
        return Response.json({
            success: false,
            message: "key already exists",
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        if (!message.includes("not found")) {
            throw error;
        }
    }

    await ctx.kvMemoryService.updateKey(old_key, new_key);

    return Response.json({
        success: true,
        data: {
            old_key,
            new_key,
        },
    });
}
