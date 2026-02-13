/**
 * End-to-end functional tests for memory decay system.
 *
 * Debug entry: if any scenario flakes, start from `waitFor()` timeouts
 * and inspect scheduler snapshot + config event buffers in each case.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getMemoryStatsHandler, getMemorySystemHealthHandler } from "../src/controller/memoryStats";
import {
  computeDecayScore,
  getDecayAlgorithmMetricsReport,
  getDecayPerformanceMonitoringSnapshot,
  resetDecayAlgorithmMetrics,
  restoreDecayPerformanceAlerts,
  updateDecayAlgorithmLogConfig,
} from "../src/libs/decay/algorithm";
import {
  getRuntimeDecayAlgorithmConfig,
  reloadRuntimeDecayAlgorithmConfig,
  reloadRuntimeDecayConfigFromFile,
  startDecayConfigFileWatch,
  stopDecayConfigFileWatch,
  subscribeDecayConfigChanges,
} from "../src/libs/decay/config";
import {
  executeMemoryDecayTask,
  initializeMemoryDecayScheduler,
  type MemoryDecaySchedulerRuntime,
} from "../src/libs/decay/scheduler-integration";

type MemorySeed = {
  key: string;
  summary: string;
  text: string;
  score: number;
  createdAt: number;
  accessCount?: number;
  inDegree?: number;
  outDegree?: number;
  lastAccessedAt?: number;
  status?: string;
};

type JsonCapture = {
  status: number;
  payload: unknown;
};

function createMemoriesTable(db: Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS memories (key TEXT PRIMARY KEY, summary TEXT NOT NULL, text TEXT NOT NULL, meta TEXT NOT NULL, score INTEGER DEFAULT 50 CHECK (score >= 0 AND score <= 100), created_at INTEGER NOT NULL)",
  );
}

function seedMemory(db: Database, memory: MemorySeed): void {
  const meta = {
    score: memory.score,
    access_count: memory.accessCount ?? 0,
    in_degree: memory.inDegree ?? 0,
    out_degree: memory.outDegree ?? 0,
    last_accessed_at: memory.lastAccessedAt ?? memory.createdAt,
    status: memory.status ?? "active",
    version: 0,
  };

  db.query("INSERT INTO memories (key, summary, text, meta, score, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    memory.key,
    memory.summary,
    memory.text,
    JSON.stringify(meta),
    memory.score,
    memory.createdAt,
  );
}

function readMemoryRow(db: Database, key: string): { score: number; meta: Record<string, unknown> } {
  const row = db.query("SELECT score, meta FROM memories WHERE key = ? LIMIT 1").get(key) as
    | { score: number; meta: string | null }
    | null;

  if (!row) {
    throw new Error(`Memory row not found: ${key}`);
  }

  return {
    score: row.score,
    meta: parseMeta(row.meta),
  };
}

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function buildControllerContext(
  db: Database,
  url: string,
  scheduler?: { getSnapshot: () => unknown },
): { context: Record<string, unknown>; getLastCall: () => JsonCapture } {
  let lastCall: JsonCapture | null = null;

  const context = {
    req: { url },
    get: (key: string): unknown => {
      if (key !== "services") {
        return undefined;
      }

      return {
        kvMemoryService: { db },
        scheduler,
      };
    },
    json: (payload: unknown, status?: number): JsonCapture => {
      lastCall = {
        payload,
        status: status ?? 200,
      };
      return lastCall;
    },
  };

  return {
    context,
    getLastCall: (): JsonCapture => {
      if (!lastCall) {
        throw new Error("No JSON response captured");
      }

      return lastCall;
    },
  };
}

async function waitFor(assertion: () => boolean, timeoutMs: number = 2_500, stepMs: number = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (assertion()) {
      return;
    }

    await Bun.sleep(stepMs);
  }

  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

describe("memory decay e2e", () => {
  let tmpRoot = "";
  let dbPath = "";
  let configPath = "";
  let openDb: Database | null = null;
  let runtimes: MemoryDecaySchedulerRuntime[] = [];

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "decay-e2e-"));
    dbPath = join(tmpRoot, "memory.db");
    configPath = join(tmpRoot, "decay.config.json");
    runtimes = [];

    stopDecayConfigFileWatch();
    resetDecayAlgorithmMetrics();
    restoreDecayPerformanceAlerts();
    updateDecayAlgorithmLogConfig({
      enabled: true,
      outputs: {
        console: false,
        file: false,
        remote: false,
      },
    });
    await reloadRuntimeDecayAlgorithmConfig({});
  });

  afterEach(async () => {
    for (const runtime of runtimes) {
      runtime.stop();
    }
    runtimes = [];

    stopDecayConfigFileWatch();

    if (openDb) {
      openDb.close();
      openDb = null;
    }

    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("covers full memory lifecycle: create, decay, and state transition", async () => {
    openDb = new Database(dbPath);
    createMemoriesTable(openDb);

    const now = Date.now();
    seedMemory(openDb, {
      key: "memory:lifecycle:cold-transition",
      summary: "cold transition",
      text: "from active to cold",
      score: 70,
      createdAt: now - 100_000,
      lastAccessedAt: now - 365 * 24 * 60 * 60 * 1000,
    });
    seedMemory(openDb, {
      key: "memory:lifecycle:deprecated-transition",
      summary: "deprecated transition",
      text: "from cold to deprecated",
      score: 30,
      createdAt: now - 200_000,
      lastAccessedAt: now - 365 * 24 * 60 * 60 * 1000,
    });

    await executeMemoryDecayTask(openDb, "http", {
      scheduler: { batchSize: 10, intervalMs: 100 },
    });

    const coldTransitionRow = readMemoryRow(openDb, "memory:lifecycle:cold-transition");
    const deprecatedTransitionRow = readMemoryRow(openDb, "memory:lifecycle:deprecated-transition");

    expect(coldTransitionRow.score).toBeLessThan(70);
    expect(coldTransitionRow.meta.status).toBe("cold");
    expect(deprecatedTransitionRow.score).toBeLessThan(30);
    expect(deprecatedTransitionRow.meta.status).toBe("deprecated");

    const metricsReport = getDecayAlgorithmMetricsReport();
    expect(metricsReport.metrics.computationCount).toBeGreaterThanOrEqual(2);
  });

  it("executes decay automatically through scheduler", async () => {
    openDb = new Database(dbPath);
    createMemoriesTable(openDb);

    const now = Date.now();
    seedMemory(openDb, {
      key: "memory:scheduler:auto",
      summary: "auto scheduler",
      text: "scheduler auto execution",
      score: 70,
      createdAt: now - 50_000,
      lastAccessedAt: now - 365 * 24 * 60 * 60 * 1000,
    });
    openDb.close();
    openDb = null;

    const runtime = initializeMemoryDecayScheduler({
      mode: "http",
      dbPath,
      taskId: "decay-auto-e2e",
      config: {
        scheduler: {
          intervalMs: 30,
          batchSize: 10,
        },
      },
    });
    runtimes.push(runtime);

    await waitFor(() => runtime.scheduler.getTaskSnapshot(runtime.taskId).metrics.runCount > 0, 3_000);

    const verifyDb = new Database(dbPath);
    const updated = readMemoryRow(verifyDb, "memory:scheduler:auto");
    verifyDb.close();

    expect(updated.score).toBeLessThan(70);
    expect(updated.meta.last_decay_at).toBeNumber();
  });

  it("supports API query and filtering behavior", async () => {
    openDb = new Database(dbPath);
    createMemoriesTable(openDb);

    const now = Date.now();
    seedMemory(openDb, {
      key: "memory:stats:old",
      summary: "old memory",
      text: "old",
      score: 80,
      createdAt: now - 200_000,
      lastAccessedAt: now - 200_000,
    });
    seedMemory(openDb, {
      key: "memory:stats:recent-1",
      summary: "recent memory one",
      text: "recent",
      score: 55,
      createdAt: now - 2_000,
      lastAccessedAt: now - 2_000,
    });
    seedMemory(openDb, {
      key: "memory:stats:recent-2",
      summary: "recent memory two",
      text: "recent",
      score: 20,
      createdAt: now - 1_000,
      lastAccessedAt: now - 1_000,
    });

    const unfilteredContext = buildControllerContext(openDb, "http://localhost/api/memories/stats");
    await getMemoryStatsHandler(unfilteredContext.context as never);
    const unfiltered = unfilteredContext.getLastCall();

    const filteredContext = buildControllerContext(
      openDb,
      `http://localhost/api/memories/stats?fromTimestamp=${now - 5_000}&toTimestamp=${now + 5_000}&histogramBinSize=5&exportFormat=json`,
    );
    await getMemoryStatsHandler(filteredContext.context as never);
    const filtered = filteredContext.getLastCall();

    expect(unfiltered.status).toBe(200);
    expect(filtered.status).toBe(200);

    const unfilteredPayload = unfiltered.payload as { ok: boolean; data: { counts: { total: number } } };
    const filteredPayload = filtered.payload as { ok: boolean; data: { counts: { total: number } } };
    expect(unfilteredPayload.ok).toBeTrue();
    expect(filteredPayload.ok).toBeTrue();
    expect(filteredPayload.data.counts.total).toBeLessThan(unfilteredPayload.data.counts.total);

    const invalidContext = buildControllerContext(
      openDb,
      "http://localhost/api/memories/stats?exportFormat=xml",
    );
    await getMemoryStatsHandler(invalidContext.context as never);
    const invalid = invalidContext.getLastCall();
    expect(invalid.status).toBe(400);
  });

  it("returns statistics and health monitoring endpoint payloads", async () => {
    openDb = new Database(dbPath);
    createMemoriesTable(openDb);

    const now = Date.now();
    seedMemory(openDb, {
      key: "memory:health:one",
      summary: "health one",
      text: "health one",
      score: 80,
      createdAt: now - 10_000,
      lastAccessedAt: now - 10_000,
    });
    seedMemory(openDb, {
      key: "memory:health:two",
      summary: "health two",
      text: "health two",
      score: 25,
      createdAt: now - 8_000,
      lastAccessedAt: now - 8_000,
    });
    openDb.close();
    openDb = null;

    const runtime = initializeMemoryDecayScheduler({
      mode: "http",
      dbPath,
      taskId: "decay-health-e2e",
      config: {
        scheduler: {
          intervalMs: 30,
          batchSize: 10,
        },
      },
    });
    runtimes.push(runtime);

    await waitFor(() => runtime.scheduler.getTaskSnapshot(runtime.taskId).metrics.runCount > 0, 3_000);

    const healthDb = new Database(dbPath);
    const statsContext = buildControllerContext(healthDb, "http://localhost/api/memories/stats");
    await getMemoryStatsHandler(statsContext.context as never);
    const statsResponse = statsContext.getLastCall();

    const healthContext = buildControllerContext(
      healthDb,
      "http://localhost/api/health/memory-system",
      runtime.scheduler,
    );
    await getMemorySystemHealthHandler(healthContext.context as never);
    const healthResponse = healthContext.getLastCall();

    healthDb.close();

    expect(statsResponse.status).toBe(200);
    expect(healthResponse.status).toBe(200);

    const healthPayload = healthResponse.payload as {
      ok: boolean;
      data: {
        status: "healthy" | "degraded" | "unhealthy";
        scheduler: { available: boolean; totalTaskCount: number };
        performance: { statisticsQueryDurationMs: number };
      };
    };
    expect(healthPayload.ok).toBeTrue();
    expect(["healthy", "degraded", "unhealthy"]).toContain(healthPayload.data.status);
    expect(healthPayload.data.scheduler.available).toBeTrue();
    expect(healthPayload.data.scheduler.totalTaskCount).toBeGreaterThan(0);
    expect(healthPayload.data.performance.statisticsQueryDurationMs).toBeGreaterThanOrEqual(0);

    const monitoring = getDecayPerformanceMonitoringSnapshot();
    expect(monitoring.generatedAt).toBeNumber();
  });

  it("supports config hot reload by API and file watch", async () => {
    const events: string[] = [];
    const unsubscribe = subscribeDecayConfigChanges((event) => {
      events.push(event.type);
    });

    try {
      await writeFile(
        configPath,
        JSON.stringify({
          scheduler: { intervalMs: 70, batchSize: 11 },
          thresholds: { activeMinScore: 75, coldMinScore: 40 },
        }),
        "utf8",
      );

      await reloadRuntimeDecayConfigFromFile(configPath, "api");
      expect(getRuntimeDecayAlgorithmConfig().scheduler.intervalMs).toBe(70);

      const watchHandle = startDecayConfigFileWatch(configPath);
      await writeFile(
        configPath,
        JSON.stringify({
          scheduler: { intervalMs: 35, batchSize: 7 },
          thresholds: { activeMinScore: 72, coldMinScore: 33 },
        }),
        "utf8",
      );

      await waitFor(() => getRuntimeDecayAlgorithmConfig().scheduler.intervalMs === 35, 3_000);
      watchHandle.stop();

      expect(events).toContain("watch_started");
      expect(events).toContain("config_reloaded");
    } finally {
      unsubscribe();
    }
  });

  it("recovers from scheduler errors and keeps config reload fault-tolerant", async () => {
    // Stage 1: boot scheduler on an empty DB file to force execution failure.
    const runtime = initializeMemoryDecayScheduler({
      mode: "http",
      dbPath,
      taskId: "decay-recovery-e2e",
      config: {
        scheduler: {
          intervalMs: 25,
          batchSize: 10,
        },
      },
    });
    runtimes.push(runtime);

    await waitFor(() => runtime.scheduler.getTaskSnapshot(runtime.taskId).metrics.failureCount > 0, 3_000);

    // Stage 2: repair schema and data so next runs can recover.
    const repairDb = new Database(dbPath);
    createMemoriesTable(repairDb);
    seedMemory(repairDb, {
      key: "memory:recovery:target",
      summary: "recovery",
      text: "repair and continue",
      score: 65,
      createdAt: Date.now() - 20_000,
      lastAccessedAt: Date.now() - 365 * 24 * 60 * 60 * 1000,
    });
    repairDb.close();

    await waitFor(
      () => {
        const snapshot = runtime.scheduler.getTaskSnapshot(runtime.taskId).metrics;
        return snapshot.successCount > 0 && snapshot.lastErrorMessage === null;
      },
      4_000,
    );

    const beforeFailedReload = getRuntimeDecayAlgorithmConfig();
    await writeFile(configPath, "{ invalid json", "utf8");

    let failed = false;
    try {
      await reloadRuntimeDecayConfigFromFile(configPath, "api");
    } catch {
      failed = true;
    }

    expect(failed).toBeTrue();
    const afterFailedReload = getRuntimeDecayAlgorithmConfig();
    expect(afterFailedReload.scheduler.intervalMs).toBe(beforeFailedReload.scheduler.intervalMs);

    const metrics = getDecayAlgorithmMetricsReport();
    expect(metrics.metrics.computationCount).toBeGreaterThan(0);
  });

  it("simulates real workflow deterministically and is repeatable", async () => {
    const now = Date.now();
    const sample = {
      key: "memory:workflow:deterministic",
      summary: "workflow deterministic",
      text: "repeatable scenario",
      meta: {
        score: 50,
        access_count: 2,
        in_degree: 1,
        out_degree: 1,
        last_accessed_at: now - 10 * 24 * 60 * 60 * 1000,
      },
    };

    const first = computeDecayScore(sample, undefined, now);
    const second = computeDecayScore(sample, undefined, now);

    expect(first.score).toBe(second.score);
    expect(first.status).toBe(second.status);
    expect(first.breakdown.timeDecayFactor).toBe(second.breakdown.timeDecayFactor);
  });
});
