/**
 * 用户登陆控制器
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 * @description 这里用户登陆不做身份验证,只获取session即可
 */

import { AppServerContext } from "../type";


export const loginController = async (req: Bun.BunRequest, ctx: AppServerContext) => {
    const sessionKey = await ctx.sessionService.generateSession() 
    return Response.json({ success: true, data: sessionKey });
};
