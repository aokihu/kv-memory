/**
 * 用户登陆控制器
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 * @description 这里用户登陆不做身份验证,只获取session即可
 */

import {z} from 'zod'
import { type AppServerContext } from "../type";

/* 类型定义 */
const RequestBodySchema = z.object({
    namespace: z.string().describe("记忆命名空间,用于Agent区分独立记忆空间"),
})

type RequestBody = z.infer<typeof RequestBodySchema>


export const loginController = async (req: Bun.BunRequest, ctx: AppServerContext) => {
    let body: RequestBody;
    try {
        body = await req.json() as RequestBody;
    } catch {
        return Response.json({ success: false, message: "invalid json" }, { status: 400 });
    }

    // 检查请求体
    const result = RequestBodySchema.safeParse(body);
    if (!result.success) {
        return Response.json({ success: false, message: result.error.message }, { status: 400 });
    }

    const {namespace} = result.data;

    const sessionKey = await ctx.sessionService.generateSession(namespace) 
    return Response.json({ success: true, data: sessionKey });
};
