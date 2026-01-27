/**
 * MCP server entrypoint
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { server, startMcpServer } from "./server";

export { server, startMcpServer };

if (import.meta.main) {
  startMcpServer().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("Failed to start MCP server:", message);
  });
}
