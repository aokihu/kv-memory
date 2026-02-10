import { spawn } from "node:child_process";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const START_SERVER = process.env.START_SERVER ?? "auto";
const SERVER_START_TIMEOUT_MS = Number(process.env.SERVER_START_TIMEOUT_MS ?? 10_000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 5_000);

const isBun = typeof Bun !== "undefined";
let serverProcess = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async (promise, timeoutMs, label) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promise(controller.signal);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const requestJson = async (path, body) => {
  const url = `${BASE_URL}${path}`;
  return withTimeout(
    async (signal) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });

      const data = await response.json();
      if (!response.ok || data?.success === false) {
        const message = data?.message ?? `HTTP ${response.status}`;
        throw new Error(`${path} failed: ${message}`);
      }
      return data;
    },
    REQUEST_TIMEOUT_MS,
    `Request ${path}`
  );
};

const requestJsonGet = async (path) => {
  const url = `${BASE_URL}${path}`;
  return withTimeout(
    async (signal) => {
      const response = await fetch(url, { method: "GET", signal });
      const data = await response.json();
      if (!response.ok || data?.success === false) {
        const message = data?.message ?? `HTTP ${response.status}`;
        throw new Error(`${path} failed: ${message}`);
      }
      return data;
    },
    REQUEST_TIMEOUT_MS,
    `Request ${path}`
  );
};

const canReachServer = async () => {
  try {
    await withTimeout(
      async (signal) => {
        const response = await fetch(`${BASE_URL}/login`, { method: "GET", signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
      },
      1_000,
      "Server probe"
    );
    return true;
  } catch {
    return false;
  }
};

const startServerIfNeeded = async () => {
  if (START_SERVER === "false") {
    return false;
  }

  if (await canReachServer()) {
    return false;
  }

  if (START_SERVER === "auto" || START_SERVER === "true") {
    if (isBun) {
      serverProcess = Bun.spawn({
        cmd: ["bun", "run", "./src/index.ts"],
        stdout: "ignore",
        stderr: "pipe",
      });
    } else {
      serverProcess = spawn("bun", ["run", "./src/index.ts"], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    }

    const startAt = Date.now();
    while (Date.now() - startAt < SERVER_START_TIMEOUT_MS) {
      if (await canReachServer()) {
        return true;
      }
      await sleep(200);
    }
    throw new Error("Server did not become ready in time");
  }

  return false;
};

const stopServerIfStarted = () => {
  if (!serverProcess) return;
  try {
    if (isBun) {
      serverProcess.kill();
    } else {
      serverProcess.kill("SIGTERM");
    }
  } catch {
    // noop
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = async () => {
  const started = await startServerIfNeeded();

  const sessionResponse = await requestJsonGet("/login");
  const session = sessionResponse?.data;
  assert(typeof session === "string" && session.length > 0, "Session key missing");

  const suffix = Date.now().toString(36);
  const existingKey = `mem-linked-${suffix}`;
  const mainKey = `mem-main-${suffix}`;
  const missingKey = `mem-missing-${suffix}`;
  const existingSummary = "linked memory summary";

  await requestJson("/add_memory", {
    key: existingKey,
    value: {
      summary: existingSummary,
      text: "Linked memory for integration test",
      links: [],
    },
  });

  await requestJson("/add_memory", {
    key: mainKey,
    value: {
      summary: "main memory",
      text: "Used to test links summary behavior",
      links: [
        { type: "decision", key: existingKey, term: "related", weight: 0.6 },
        { type: "bug", key: missingKey, term: "missing", weight: 0.4 },
      ],
    },
  });

  const memoryResponse = await requestJson("/get_memory", {
    key: mainKey,
    session,
  });

  const memory = memoryResponse?.data;
  assert(memory && typeof memory === "object", "Memory response missing");

  assert(!("meta" in memory), "meta should not be present in response");
  assert(Array.isArray(memory.links), "links should be an array");

  const linkedExisting = memory.links.find((link) => link.key === existingKey);
  const linkedMissing = memory.links.find((link) => link.key === missingKey);

  assert(linkedExisting?.summary === existingSummary, "Existing linked summary mismatch");
  assert(linkedMissing?.summary === "关联记忆不存在", "Missing linked summary mismatch");

  for (const link of memory.links) {
    assert(typeof link.summary === "string", "Link summary should be present");
  }

  console.log("Integration check passed", {
    startedServer: started,
    mainKey,
  });
};

try {
  await run();
} catch (error) {
  console.error("Integration check failed:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  stopServerIfStarted();
}
