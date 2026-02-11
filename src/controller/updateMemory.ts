/**
 * 更新记忆控制器
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 * @description RequestBody.value 使用 Partial<MemoryNoMeta>，链接通过独立links字段提交，拒绝domain和type字段
 */
import { z } from 'zod'
import { MemoryLink, type AppServerContext, type MemoryNoMeta, MemoryNoMetaSchema } from '../type'

// 拒绝domain和type字段的验证器
const RejectDomainTypeSchema = z.object({
    domain: z.never().optional(),
    type: z.never().optional(),
})

const RequestBodySchema = z.object({
    session: z.string(),
    key: z.string(),
    value: MemoryNoMetaSchema.partial().and(RejectDomainTypeSchema),
    links: z.array(MemoryLink).optional(),
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

    const { key, session, value, links } = result.data;
    

    // 验证session
    const sessionData = await ctx.sessionService.getSession(session);
    if (!sessionData) {
        return Response.json({
            success: false,
            message: "invalid session",
        });
    }

    const ns = sessionData.kv_namespace;
    console.log('Session Data', sessionData)
    console.log("Update memory:", ns, key, value)

    // 检查记忆是否存在
    const existingMemory = await ctx.kvMemoryService.getMemory(ns, key);
    if (!existingMemory) {
        return Response.json({
            success: false,
            message: "memory not found",
        });
    }

    // 更新记忆
    await ctx.kvMemoryService.updateMemory(ns, key, value as Partial<MemoryNoMeta>, links);

    return Response.json({
        success: true,
        data: {
            key,
        },
    });
}
