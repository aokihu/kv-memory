/**
 * Memory statistics controller for monitoring endpoints.
 *
 * Debug entry: start from `resolveStatisticsDbFromContext()` when endpoint returns 500.
 */

import {
  getMemoryStateStatistics,
  type MemoryStateStatisticsExportFormat,
  type MemoryStateStatisticsOptions,
  type MemoryStatisticsReadableDb,
} from "../libs/kv/db/query";
import type { AppServerContext } from "../type";

type JsonResponseWriter = (payload: unknown, status?: number) => unknown;

type RequestQueryReader = {
  query?: (key?: string) => string | Record<string, string | undefined> | undefined;
  url?: string;
};

type ControllerContext = {
  req: RequestQueryReader;
  json: JsonResponseWriter;
  get?: (key: string) => unknown;
};

type RouteRegistrar = {
  get: (path: string, handler: (context: ControllerContext) => Promise<unknown>) => unknown;
};

type StatisticsRequestContext = {
  services?: AppServerContext;
  appContext?: AppServerContext;
  kvMemoryService?: AppServerContext["kvMemoryService"];
  scheduler?: SchedulerReadable;
  memoryScheduler?: SchedulerReadable;
  decayScheduler?: SchedulerReadable;
};

type SchedulerTaskMetricsReadable = {
  runCount: number;
  successCount: number;
  failureCount: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastErrorMessage: string | null;
};

type SchedulerTaskSnapshotReadable = {
  id: string;
  status: "idle" | "running" | "paused" | "stopped";
  metrics: SchedulerTaskMetricsReadable;
};

type SchedulerSnapshotReadable = {
  totalTaskCount: number;
  runningTaskCount: number;
  pausedTaskCount: number;
  stoppedTaskCount: number;
  tasks: SchedulerTaskSnapshotReadable[];
};

type SchedulerReadable = {
  getSnapshot: () => SchedulerSnapshotReadable;
};

type MemorySystemHealthStatus = "healthy" | "degraded" | "unhealthy";

type MemorySystemHealthResponse = {
  status: MemorySystemHealthStatus;
  scheduler: {
    available: boolean;
    totalTaskCount: number;
    totalRunCount: number;
    runningTaskCount: number;
    pausedTaskCount: number;
    stoppedTaskCount: number;
    lastRunAt: number | null;
    nextRunAt: number | null;
    lastErrorMessage: string | null;
    errorTaskCount: number;
  };
  memoryOverview: {
    generatedAt: number;
    totalCount: number;
    states: {
      active: number;
      cold: number;
      deprecated: number;
    };
  };
  performance: {
    statisticsQueryDurationMs: number;
    schedulerFailureRate: number | null;
    averageTaskRunCount: number | null;
    schedulerLagMs: number | null;
  };
};

const SLOW_STATISTICS_QUERY_THRESHOLD_MS = 1500;

const SUPPORTED_EXPORT_FORMATS: MemoryStateStatisticsExportFormat[] = ["json", "csv", "both"];

/**
 * Read query value from multiple request shapes.
 *
 * This branch exists because controller tests and runtime adapters may expose
 * query values differently.
 */
function readQueryValue(request: RequestQueryReader, key: string): string | undefined {
  if (typeof request.query === "function") {
    const functionResult = request.query(key);

    if (typeof functionResult === "string") {
      return functionResult;
    }

    if (functionResult && typeof functionResult === "object" && key in functionResult) {
      const value = (functionResult as Record<string, string | undefined>)[key];
      return typeof value === "string" ? value : undefined;
    }
  }

  if (typeof request.url === "string") {
    const parsed = new URL(request.url, "http://localhost");
    const value = parsed.searchParams.get(key);
    return value ?? undefined;
  }

  return undefined;
}

/**
 * Parse an integer query parameter.
 *
 * Debug hint: malformed query values are rejected here with field-specific errors.
 */
function parseIntegerQuery(value: string | undefined, field: string): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid query parameter \`${field}\`: expected integer`);
  }

  return parsed;
}

/**
 * Parse export format query parameter.
 */
function parseExportFormat(value: string | undefined): MemoryStateStatisticsExportFormat | undefined {
  if (!value) {
    return undefined;
  }

  if (SUPPORTED_EXPORT_FORMATS.includes(value as MemoryStateStatisticsExportFormat)) {
    return value as MemoryStateStatisticsExportFormat;
  }

  throw new Error("Invalid query parameter `exportFormat`: expected json,csv,both");
}

/**
 * Build statistics options from request query parameters.
 */
function buildStatisticsOptions(request: RequestQueryReader): MemoryStateStatisticsOptions {
  const fromTimestamp = parseIntegerQuery(readQueryValue(request, "fromTimestamp"), "fromTimestamp");
  const toTimestamp = parseIntegerQuery(readQueryValue(request, "toTimestamp"), "toTimestamp");
  const histogramBinSize = parseIntegerQuery(readQueryValue(request, "histogramBinSize"), "histogramBinSize");
  const cacheTtlMs = parseIntegerQuery(readQueryValue(request, "cacheTtlMs"), "cacheTtlMs");
  const exportFormat = parseExportFormat(readQueryValue(request, "exportFormat"));

  return {
    fromTimestamp,
    toTimestamp,
    histogramBinSize,
    cacheTtlMs,
    exportFormat,
  };
}

/**
 * Resolve statistics DB from app context.
 *
 * If this fails, inspect runtime service wiring and verify `kvMemoryService` exposes `db`.
 */
function resolveStatisticsDbFromContext(context: ControllerContext): MemoryStatisticsReadableDb {
  const rawContext = (context.get?.("services") ?? context.get?.("appContext") ?? {}) as StatisticsRequestContext;
  const appContext = rawContext.services ?? rawContext.appContext ?? (rawContext as unknown as AppServerContext);
  const kvMemoryService = appContext?.kvMemoryService ?? rawContext.kvMemoryService;

  const db = (kvMemoryService as unknown as { db?: MemoryStatisticsReadableDb })?.db;
  if (!db) {
    throw new Error("Statistics db unavailable from request context");
  }

  return db;
}

/**
 * Resolve scheduler object from app context.
 *
 * Debug hint: when scheduler fields are all null/zero, verify runtime service key mapping first.
 */
function resolveSchedulerFromContext(context: ControllerContext): SchedulerReadable | null {
  const rawContext = (context.get?.("services") ?? context.get?.("appContext") ?? {}) as StatisticsRequestContext;
  const appContext = (rawContext.services ?? rawContext.appContext ?? rawContext) as StatisticsRequestContext;

  const scheduler =
    appContext.scheduler ??
    appContext.memoryScheduler ??
    appContext.decayScheduler ??
    rawContext.scheduler ??
    rawContext.memoryScheduler ??
    rawContext.decayScheduler;

  if (!scheduler || typeof scheduler.getSnapshot !== "function") {
    return null;
  }

  return scheduler;
}

/**
 * Build scheduler status summary.
 */
function buildSchedulerSummary(snapshot: SchedulerSnapshotReadable | null): MemorySystemHealthResponse["scheduler"] {
  if (!snapshot) {
    return {
      available: false,
      totalTaskCount: 0,
      totalRunCount: 0,
      runningTaskCount: 0,
      pausedTaskCount: 0,
      stoppedTaskCount: 0,
      lastRunAt: null,
      nextRunAt: null,
      lastErrorMessage: null,
      errorTaskCount: 0,
    };
  }

  let lastRunAt: number | null = null;
  let nextRunAt: number | null = null;
  let lastErrorMessage: string | null = null;
  let lastErrorAt: number | null = null;
  let errorTaskCount = 0;
  let totalRunCount = 0;

  for (const task of snapshot.tasks) {
    const { metrics } = task;

    if (typeof metrics.lastRunAt === "number" && (lastRunAt === null || metrics.lastRunAt > lastRunAt)) {
      lastRunAt = metrics.lastRunAt;
    }

    if (typeof metrics.nextRunAt === "number" && (nextRunAt === null || metrics.nextRunAt < nextRunAt)) {
      nextRunAt = metrics.nextRunAt;
    }

    if (metrics.lastErrorMessage) {
      errorTaskCount += 1;
      const errorAt = typeof metrics.lastRunAt === "number" ? metrics.lastRunAt : 0;
      if (lastErrorAt === null || errorAt >= lastErrorAt) {
        lastErrorAt = errorAt;
        lastErrorMessage = metrics.lastErrorMessage;
      }
    }

    totalRunCount += metrics.runCount;
  }

  return {
    available: true,
    totalTaskCount: snapshot.totalTaskCount,
    totalRunCount,
    runningTaskCount: snapshot.runningTaskCount,
    pausedTaskCount: snapshot.pausedTaskCount,
    stoppedTaskCount: snapshot.stoppedTaskCount,
    lastRunAt,
    nextRunAt,
    lastErrorMessage,
    errorTaskCount,
  };
}

/**
 * Build performance indicators for health response.
 */
function buildPerformanceMetrics(
  scheduler: MemorySystemHealthResponse["scheduler"],
  statisticsQueryDurationMs: number,
): MemorySystemHealthResponse["performance"] {
  if (!scheduler.available || scheduler.totalTaskCount === 0) {
    return {
      statisticsQueryDurationMs,
      schedulerFailureRate: null,
      averageTaskRunCount: null,
      schedulerLagMs: scheduler.lastRunAt ? Math.max(0, Date.now() - scheduler.lastRunAt) : null,
    };
  }

  const schedulerFailureRate = Math.round((scheduler.errorTaskCount / scheduler.totalTaskCount) * 10000) / 100;
  const averageTaskRunCount = Math.round((scheduler.totalRunCount / scheduler.totalTaskCount) * 100) / 100;

  return {
    statisticsQueryDurationMs,
    schedulerFailureRate,
    averageTaskRunCount,
    schedulerLagMs: scheduler.lastRunAt ? Math.max(0, Date.now() - scheduler.lastRunAt) : null,
  };
}

/**
 * Resolve overall health status from scheduler and performance signals.
 */
function resolveOverallHealthStatus(payload: MemorySystemHealthResponse): MemorySystemHealthStatus {
  const { scheduler, performance } = payload;

  if (scheduler.available && scheduler.totalTaskCount > 0 && scheduler.runningTaskCount === 0) {
    return "unhealthy";
  }

  if (performance.statisticsQueryDurationMs > SLOW_STATISTICS_QUERY_THRESHOLD_MS) {
    return "degraded";
  }

  if (!scheduler.available) {
    return "degraded";
  }

  if (scheduler.errorTaskCount > 0) {
    return "degraded";
  }

  return "healthy";
}

/**
 * GET /api/health/memory-system
 *
 * API docs:
 * - response.status: overall system health (healthy/degraded/unhealthy)
 * - response.scheduler: scheduler runtime summary
 * - response.memoryOverview: memory count and state distribution
 * - response.performance: health-related runtime metrics
 */
export async function getMemorySystemHealthHandler(context: ControllerContext): Promise<unknown> {
  try {
    const db = resolveStatisticsDbFromContext(context);
    const scheduler = resolveSchedulerFromContext(context);
    const statisticsStartAt = Date.now();
    const statistics = getMemoryStateStatistics(db, { exportFormat: "json" });
    const statisticsQueryDurationMs = Date.now() - statisticsStartAt;
    const schedulerSnapshot = scheduler?.getSnapshot() ?? null;
    const schedulerSummary = buildSchedulerSummary(schedulerSnapshot);

    const response: MemorySystemHealthResponse = {
      status: "healthy",
      scheduler: schedulerSummary,
      memoryOverview: {
        generatedAt: statistics.generatedAt,
        totalCount: statistics.counts.total,
        states: {
          active: statistics.counts.active,
          cold: statistics.counts.cold,
          deprecated: statistics.counts.deprecated,
        },
      },
      performance: buildPerformanceMetrics(schedulerSummary, statisticsQueryDurationMs),
    };

    response.status = resolveOverallHealthStatus(response);

    return context.json(
      {
        ok: true,
        data: response,
      },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return context.json(
      {
        ok: false,
        error: {
          message,
        },
      },
      500,
    );
  }
}

/**
 * GET /api/memories/stats
 *
 * API docs:
 * - query.fromTimestamp: optional unix timestamp lower bound
 * - query.toTimestamp: optional unix timestamp upper bound
 * - query.histogramBinSize: optional histogram bin size (1-100)
 * - query.cacheTtlMs: optional cache ttl in milliseconds
 * - query.exportFormat: optional export format, one of json,csv,both
 */
export async function getMemoryStatsHandler(context: ControllerContext): Promise<unknown> {
  try {
    const options = buildStatisticsOptions(context.req);
    const db = resolveStatisticsDbFromContext(context);
    const statistics = getMemoryStateStatistics(db, options);

    return context.json(
      {
        ok: true,
        data: statistics,
      },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isBadRequest = message.startsWith("Invalid query parameter");

    return context.json(
      {
        ok: false,
        error: {
          message,
        },
      },
      isBadRequest ? 400 : 500,
    );
  }
}

/**
 * Register memory statistics route.
 */
export function registerMemoryStatsController(router: RouteRegistrar): void {
  router.get("/api/memories/stats", getMemoryStatsHandler);
  router.get("/api/health/memory-system", getMemorySystemHealthHandler);
}
