/**
 * KVDB Memory
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 * @license MIT
 */

import type { AppServerContext } from "./type";
import { addMemoryController, loginController, getMemoryController, updateMemoryController, updateMemoryKeyController } from "./controller";
import { SessionService, KVMemoryService } from "./service";

const context: AppServerContext = {
  sessionService: new SessionService(),
  kvMemoryService: new KVMemoryService(),
}

export const server = Bun.serve({
  port: 3000,
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
  }
});

