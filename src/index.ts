/**
 * KVDB Memory
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 * @license MIT
 */

import type { AppServerContext } from "./type";
import {
  addMemoryController,
  loginController,
  getMemoryController,
  updateMemoryController,
  updateMemoryKeyController,
  SearchController,
} from "./controller";
import { SessionService, KVMemoryService } from "./service";

const context: AppServerContext = {
  sessionService: new SessionService(),
  kvMemoryService: new KVMemoryService(),
}

const searchController = new SearchController(context.kvMemoryService);

export const server = Bun.serve({
  port: 3030,
  routes: {
    "/login": { POST: (req) => loginController(req, context) },
    "/get_memory": { POST: (req) => getMemoryController(req, context) },
    "/add_memory": {
      POST: (req) => addMemoryController(req, context),
    },
    "/update_memory": {
      POST: (req) => updateMemoryController(req, context),
    },
    "/update_memory_key": {
      POST: (req) => updateMemoryKeyController(req, context),
    },
    "/search": {
      GET: async (req) => {
        try {
          return await searchController.search(req);
        } catch (error) {
          // Debug 起点: 如果控制器外层异常触发，优先检查 SearchController 是否被正确实例化。
          console.error("[search] route error", error);
          return Response.json({ success: false, message: "search route failed" }, { status: 500 });
        }
      },
    },
    "/fulltext": {
      GET: async (req) => {
        try {
          return await searchController.fulltextSearch(req);
        } catch (error) {
          // Debug 起点: 如果全文搜索路由报错，先检查请求 query 和 controller 方法绑定。
          console.error("[fulltext] route error", error);
          return Response.json({ success: false, message: "fulltext route failed" }, { status: 500 });
        }
      },
    },
  }
});
