/**
 * 获取记忆控制器
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 * @summary 获取记忆,并且更新记忆的meta数据
 */
import { z } from 'zod'
import { type AppServerContext } from "../type"

/* 类型定义 */
const SortLinksSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();

        if (normalized === 'true') {
            return true;
        }

        if (normalized === 'false') {
            return false;
        }
    }

    return value;
}, z.boolean({ message: 'sortLinks must be true or false' }).optional().default(true));

const RequestBodySchema = z.object({
    key: z.string(),
    session: z.string(),
    sortLinks: SortLinksSchema
})

type RequestBody = z.infer<typeof RequestBodySchema>


/* 控制器 */
export const getMemoryController = async (req: Bun.BunRequest<"/get_memory">, ctx: AppServerContext) => {

    let body: RequestBody;
    try {
        body = await req.json() as RequestBody;
    } catch {
        return Response.json({ success: false, message: "invalid json" }, { status: 400 });
    }

    // 检验请求体
    const result = RequestBodySchema.safeParse(body);

    if (result.error) {
        return Response.json({ success: false, message: result.error.issues }, { status: 400 });
    }

    const { key, session, sortLinks } = result.data;

    const kvMemoryService = ctx.kvMemoryService as unknown as {
        traverseMemory: (namespace: string, key: string) => Promise<unknown>,
        getMemory: (namespace: string, key: string, sortLinks?: boolean) => Promise<unknown>
    }

    // 验证session
    const sessionData = await ctx.sessionService.getSession(session);
    if (!sessionData) {
        return Response.json({
            success: false,
            message: "invalid session",
        });
    }

    // 从session中获取用户之前访问的记忆key
    const lastMemoryKey = sessionData.last_memory_key;
    const ns = sessionData.kv_namespace;

    if (lastMemoryKey !== '') {
        // 更新上一次访问的记忆连接记录
        await kvMemoryService.traverseMemory(ns, lastMemoryKey);
    }

    // 从KVDB中获取内存
    const memory = await kvMemoryService.getMemory(ns, key, sortLinks);
    if (!memory) {
        return Response.json({
            success: false,
            message: "memory not found",
        });
    }

    // 更新session中的last_memory_key
    await ctx.sessionService.setSession(session, { last_memory_key: key });

    return Response.json({
        success: true,
        data: memory,
    })
}
