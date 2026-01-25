/**
 * 添加记忆
 * @param key {string} 记忆的key
 * @param arg {Optional<KVValue, "keywords" | "links">} 记忆的value
 * @description
 */
import z from 'zod'
import { MemoryNoMetaSchema } from '../type'
import type { Optional, KVValue, AppServerContext } from "../type";



/* Request 请求体类型 */
const RequestBodySchema = z.object({
    key: z.string(),
    value: MemoryNoMetaSchema.extend({
        links: MemoryNoMetaSchema.shape.links.optional(),
        keywords: MemoryNoMetaSchema.shape.keywords.optional(),
    }),
})

type RequestBody = z.infer<typeof RequestBodySchema>


/* 控制器 */
export const addMemoryController = async (req: Bun.BunRequest<"/add_memory">, ctx: AppServerContext) => {
    const body = await req.json() as unknown as RequestBody;
    const result = RequestBodySchema.safeParse(body);

    if (result.error) {
        return Response.json({ success: false, message: result.error.issues }, { status: 400 });
    }

    const { key, value } = result.data;

    await ctx.kvMemoryService.addMemory(key, {
        ...value,
        links: value.links ?? [],
        keywords: value.keywords ?? [],
    });
    
    return Response.json({ success: true });
}
