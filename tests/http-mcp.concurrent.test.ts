/**
 * Multi-process HTTP/MCP concurrent write integration tests.
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HTTP_WORKER_SCRIPT = `
async function main() {
  const prefix = process.argv[1];
  const total = Number(process.argv[2]);
  const lockMarker = process.argv[3];

  const { loginController, addMemoryController } = await import("./src/controller/index.ts");
  const { SessionService, KVMemoryService } = await import("./src/service/index.ts");
  const { getDatabase, runInTransactionWithRetry } = await import("./src/libs/kv/db/index.ts");

  const ctx = {
    sessionService: new SessionService(),
    kvMemoryService: new KVMemoryService(),
  };

  for (let attempt = 0; attempt < 400 && !require("node:fs").existsSync(lockMarker); attempt += 1) {
    await Bun.sleep(5);
  }

  const db = getDatabase();
  await runInTransactionWithRetry(
    db,
    () => {
      // This empty transaction intentionally probes lock contention and retry flow.
    },
    {
      maxAttempts: 150,
      initialDelayMs: 5,
      maxDelayMs: 20,
      logger: console,
    },
  );

  const loginResponse = await loginController(
    new Request("http://test/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ namespace: prefix + "_http_ns" }),
    }),
    ctx,
  );
  const loginPayload = await loginResponse.json();
  if (!loginPayload.success) {
    throw new Error("http worker failed to create session");
  }

  const session = loginPayload.data;
  for (let index = 0; index < total; index += 1) {
    const response = await addMemoryController(
      new Request("http://test/add_memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session,
          key: prefix + "_http_" + index,
          value: {
            summary: "http-summary-" + index,
            text: "http-text-" + index,
          },
          links: [],
        }),
      }),
      ctx,
    );
    const payload = await response.json();
    if (!payload.success) {
      throw new Error("http worker add failed at index=" + index + ": " + JSON.stringify(payload));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

const MCP_WORKER_SCRIPT = `
const fs = require("node:fs");

async function main() {
  const prefix = process.argv[1];
  const total = Number(process.argv[2]);
  const lockMarker = process.argv[3];

  const { createSessionNewTool, createMemoryAddTool } = await import("./src/mcp/tools/index.ts");
  const { SessionService, KVMemoryService } = await import("./src/service/index.ts");
  const { getDatabase } = await import("./src/libs/kv/db/index.ts");

  const sessionService = new SessionService();
  const kvMemoryService = new KVMemoryService();
  const sessionTool = createSessionNewTool(sessionService);
  const memoryAddTool = createMemoryAddTool(sessionService, kvMemoryService);

  const db = getDatabase();
  db.exec("CREATE TABLE IF NOT EXISTS lock_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  db.exec("BEGIN IMMEDIATE");
  db.query("INSERT INTO lock_probe (value) VALUES (?)").run("lock-held");
  fs.writeFileSync(lockMarker, "locked");
  await Bun.sleep(1200);
  db.exec("COMMIT");

  const rawSession = await sessionTool.execute({ namespace: prefix + "_mcp_ns" });
  const sessionPayload = JSON.parse(rawSession);
  const session = sessionPayload.data?.sessionKey;
  if (!session) {
    throw new Error("mcp worker failed to create session");
  }

  for (let index = 0; index < total; index += 1) {
    const rawResult = await memoryAddTool.execute({
      session,
      key: prefix + "_mcp_" + index,
      value: {
        summary: "mcp-summary-" + index,
        text: "mcp-text-" + index,
      },
      links: [],
      output_format: "json",
    });

    const payload = JSON.parse(rawResult);
    if (!payload.success) {
      throw new Error("mcp worker add failed at index=" + index + ": " + rawResult);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

function makeTempDatabasePath(): { dir: string; file: string; lockMarker: string } {
  const dir = mkdtempSync(join(tmpdir(), "kvdb-mem-http-mcp-"));
  const file = join(dir, "http-mcp-concurrent.db");
  const lockMarker = join(dir, "lock.marker");
  return { dir, file, lockMarker };
}

async function readProcessOutput(process: Bun.Subprocess): Promise<{ stdout: string; stderr: string }> {
  const stdout = process.stdout instanceof ReadableStream ? await new Response(process.stdout).text() : "";
  const stderr = process.stderr instanceof ReadableStream ? await new Response(process.stderr).text() : "";
  return { stdout, stderr };
}

describe("http+mcp concurrent access", () => {
  test("two-process writes remain consistent and retry under lock contention", async () => {
    const { dir, file, lockMarker } = makeTempDatabasePath();
    const prefix = `dual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const writesPerWorker = 40;

    try {
      const mcpWorker = Bun.spawn(["bun", "-e", MCP_WORKER_SCRIPT, prefix, String(writesPerWorker), lockMarker], {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          KVDB_SQLITE_FILE: file,
          KVDB_SQLITE_BUSY_TIMEOUT_MS: "0",
        },
      });

      for (let attempt = 0; attempt < 400 && !existsSync(lockMarker); attempt += 1) {
        await Bun.sleep(5);
      }

      expect(existsSync(lockMarker)).toBe(true);

      const startedAt = Date.now();
      const httpWorker = Bun.spawn(["bun", "-e", HTTP_WORKER_SCRIPT, prefix, String(writesPerWorker), lockMarker], {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          KVDB_SQLITE_FILE: file,
          KVDB_SQLITE_BUSY_TIMEOUT_MS: "0",
        },
      });

      const [mcpExitCode, httpExitCode] = await Promise.all([mcpWorker.exited, httpWorker.exited]);
      const [mcpOutput, httpOutput] = await Promise.all([readProcessOutput(mcpWorker), readProcessOutput(httpWorker)]);
      const elapsedMs = Date.now() - startedAt;

      expect(mcpExitCode).toBe(0);
      expect(httpExitCode).toBe(0);

      const db = new Database(file);
      try {
        const httpRows = db
          .query("SELECT COUNT(*) AS count FROM memories WHERE key LIKE ?")
          .get(`${prefix}_http_%`) as { count: number };
        const mcpRows = db
          .query("SELECT COUNT(*) AS count FROM memories WHERE key LIKE ?")
          .get(`${prefix}_mcp_%`) as { count: number };

        expect(httpRows.count).toBe(writesPerWorker);
        expect(mcpRows.count).toBe(writesPerWorker);
      } finally {
        db.close();
      }

      // HTTP worker should be blocked by MCP write lock and resume after lock release.
      expect(elapsedMs >= 900).toBe(true);

      // Keep output reads as a debug anchor when this integration test fails in CI.
      expect(httpOutput.stderr.includes("Error") || mcpOutput.stderr.includes("Error")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
