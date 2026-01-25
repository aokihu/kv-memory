/**
 * 获取记忆控制器
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 * @summary 获取记忆,并且更新记忆的meta数据
 */
import { AppServerContext } from "../type"

type RequestBody = {
    key: string,
    session: string,
}

export const getMemoryController = async (req: Bun.BunRequest<"/get_memory">, ctx: AppServerContext) => {

    let body: RequestBody;
    try {
        body = await req.json();
    } catch {
        return Response.json({ success: false, message: "invalid json" }, { status: 400 });
    }

    const { key, session } = body;

    if (!key || !session) {
        return Response.json({ success: false, message: "missing key or session" }, { status: 400 });
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

    if (lastMemoryKey !== '') {
        // 更新上一次访问的记忆连接记录
        await ctx.kvMemoryService.traverseMemory(lastMemoryKey);
    }

    // 从KVDB中获取内存
    const memory = await ctx.kvMemoryService.getMemory(key);
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
