/**
 * 更新记忆控制器
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 * @description RequestBody.value 使用 Partial<MemoryNoMeta>，关键词和链接可选
 */
import { z } from 'zod'
import { type AppServerContext, type MemoryNoMeta, MemoryNoMetaSchema } from '../type'

const RequestBodySchema = z.object({
    session: z.string(),
    key: z.string(),
    value: MemoryNoMetaSchema.partial(),
})

type RequestBody = z.infer<typeof RequestBodySchema>

export const updateMemoryController = async (req: Bun.BunRequest<"/update_memory">, ctx: AppServerContext) => {
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

    const { key, session, value } = result.data;

    // 验证session
    const sessionData = await ctx.sessionService.getSession(session);
    if (!sessionData) {
        return Response.json({
            success: false,
            message: "invalid session",
        });
    }

    // 检查记忆是否存在
    try {
        await ctx.kvMemoryService.getMemory(key);
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

    // 更新记忆
    await ctx.kvMemoryService.updateMemory(key, value as Partial<MemoryNoMeta>);

    return Response.json({
        success: true,
        data: {
            key,
        },
    });
}
