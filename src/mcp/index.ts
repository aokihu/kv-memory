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
  let decaySchedulerRuntime: ReturnType<typeof initializeMemoryDecayScheduler> | undefined;

  try {
    // 尝试初始化衰退调度器，但允许失败
    decaySchedulerRuntime = initializeMemoryDecayScheduler({
      mode: "mcp",
    });
    console.info("[mcp] Memory decay scheduler initialized successfully");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[mcp] Failed to initialize memory decay scheduler: ${message}`);
    console.warn("[mcp] Continuing without decay scheduler - memory scores will not be updated automatically");
  }

  let hasMcpShutdownCleanupRun = false;

  const cleanup = (): void => {
    if (hasMcpShutdownCleanupRun) {
      return;
    }

    hasMcpShutdownCleanupRun = true;
    
    // 只有在调度器成功初始化时才停止
    if (decaySchedulerRuntime) {
      try {
        decaySchedulerRuntime.stop();
        console.info("[mcp] Memory decay scheduler stopped");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[mcp] Error stopping decay scheduler: ${message}`);
      }
    }
  };

  registerMcpShutdownHooks(cleanup);

  startMcpServer().catch((error) => {
    cleanup();
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("Failed to start MCP server:", message);
    process.exitCode = 1;
  });
}
