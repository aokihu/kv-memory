/**
 * KVDB Memory
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 * @license MIT
 */

import type { AppServerContext } from "./type";
import { addMemoryController, loginController, getMemoryController } from "./controller";
import { SessionService, KVMemoryService } from "./service";

const context: AppServerContext = {
  sessionService: new SessionService(),
  kvMemoryService: new KVMemoryService(),
}

const server = Bun.serve({
  port: 3000,
  routes: {
    "/login": (req) => loginController(req, context),
    "/get_memory": (req) => getMemoryController(req, context),
    "/add_memory": {
      POST: (req) => addMemoryController(req, context),
    },
    "/update_memory": () => new Response(),
    "/update_memory_key": () => new Response(),
  }
});

