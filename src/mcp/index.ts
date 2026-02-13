/**
 * MCP server entrypoint
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { server, startMcpServer } from "./server";
import { initializeMemoryDecayScheduler } from "../libs/decay/scheduler-integration";

export { server, startMcpServer };

function registerMcpShutdownHooks(cleanup: () => void): void {
  process.on("SIGINT", () => {
    console.info("[mcp] SIGINT received, stopping decay scheduler");
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.info("[mcp] SIGTERM received, stopping decay scheduler");
    cleanup();
    process.exit(0);
  });

  process.on("beforeExit", () => {
    cleanup();
  });

  process.on("exit", () => {
    cleanup();
  });
}

if (import.meta.main) {
  const decaySchedulerRuntime = initializeMemoryDecayScheduler({
    mode: "mcp",
  });

  let hasMcpShutdownCleanupRun = false;

  const cleanup = (): void => {
    if (hasMcpShutdownCleanupRun) {
      return;
    }

    hasMcpShutdownCleanupRun = true;
    decaySchedulerRuntime.stop();
  };

  registerMcpShutdownHooks(cleanup);

  startMcpServer().catch((error) => {
    cleanup();
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("Failed to start MCP server:", message);
    process.exitCode = 1;
  });
}
