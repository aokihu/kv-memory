/**
 * 添加记忆
 * @param key {string} 记忆的key
 * @param arg {MemoryNoMeta} 记忆的value
 * @description
 */
import { z } from 'zod'
import { MemoryNoMetaSchema } from '../type'
import type { MemoryNoMeta, AppServerContext } from "../type";



/* Request 请求体类型 */
const RequestBodySchema = z.object({
    session: z.string().describe("session id"),
    key: z.string(),
    value: MemoryNoMetaSchema.extend({
        links: MemoryNoMetaSchema.shape.links.optional(),
    }).strict(), // 拒绝任何额外字段，包括 domain 和 type
})

type RequestBody = z.infer<typeof RequestBodySchema>


/* 控制器 */
export const addMemoryController = async (req: Bun.BunRequest<"/add_memory">, ctx: AppServerContext) => {

    try {
        const body = await req.json() as unknown as RequestBody;

        const result = RequestBodySchema.safeParse(body);

        if (result.error) {
            return Response.json({ success: false, message: result.error.issues }, { status: 400 });
        }

        const { session, key, value } = result.data;

        // 从session中获取命名空间
        const sessionData = await ctx.sessionService.getSession(session);
        if (!sessionData) {
            return Response.json({ success: false, message: "invalid session" }, { status: 400 });
        }
        const ns = sessionData.kv_namespace;

        // 从KVDB中添加记忆
        await ctx.kvMemoryService.addMemory(ns, key, {
            ...value,
            links: value.links ?? [],
        });

        return Response.json({ success: true });
    } catch (error) {
        return Response.json({ success: false, message: "JSON parsed error" }, { status: 400 });
    }
}
