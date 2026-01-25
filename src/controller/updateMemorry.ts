/**
 * 更新记忆控制器
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 * @description RequestBody.value 使用 Partial<MemoryNoMeta>，关键词和链接可选
 */
import { z } from 'zod'
import { AppServerContext, MemoryNoMeta, MemoryNoMetaSchema } from '../type'

const RequestBodySchema = z.object({
    key: z.string(),
    value: MemoryNoMetaSchema.partial(),
})

type RequestBody = z.infer<typeof RequestBodySchema>

export const updateMemoryController = async (req: Bun.BunRequest<"/update_memory">, ctx: AppServerContext) => {
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

    const { key, value } = result.data;

    if (!key || !value) {
        return Response.json({ success: false, message: "missing key or value" }, { status: 400 });
    }

    // 更新记忆
    await ctx.kvMemoryService.updateMemory(key, value);

    return Response.json({ success: true });
}
