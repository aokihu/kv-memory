/**
 * Memory decay algorithm core implementation.
 * Provides deterministic score calculation and status classification.
 */

import { DEFAULT_DECAY_CONFIG, resolveDecayConfig, type DecayConfigInput } from "./config";
import type { DecayComputationResult, DecayMemory, DecayStatus } from "./types";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const SCORE_MIN = 0;
const SCORE_MAX = 100;
const FREQUENCY_WINDOW_MS = 60_000;
const MAX_FREQUENCY_SAMPLES = 10_000;
const MAX_ALERT_HISTORY = 2_000;
const DEFAULT_ALERT_SILENCE_MS = 5 * 60_000;
const MAX_LOG_BUFFER = 10_000;
const DEFAULT_LOG_FILE_PATH = "logs/decay-algorithm.log";

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const LOG_LEVEL_PRIORITY: Record<DecayLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const LOG_EVENT_TYPES = [
  "algorithm_start",
  "algorithm_end",
  "calculation_step",
  "score_change",
  "state_transition",
  "error",
  "performance_metric",
  "config_change",
  "rotation",
  "cleanup",
  "query",
] as const;

const STATUS_VALUES: readonly DecayStatus[] = ["active", "cold", "deprecated"];
const ALERT_METRICS = ["latency", "error_rate", "memory_usage", "state_transition_anomaly"] as const;

export type DecayAlertMetric = (typeof ALERT_METRICS)[number];
export type DecayAlertSeverity = "warning" | "critical";
export type DecayAlertState = "active" | "silenced";
export type DecayAlertEventType = "triggered" | "updated" | "recovered" | "silenced" | "unsilenced";
export type DecayLogLevel = "debug" | "info" | "warn" | "error";
export type DecayLogEventType =
  | "algorithm_start"
  | "algorithm_end"
  | "calculation_step"
  | "score_change"
  | "state_transition"
  | "error"
  | "performance_metric"
  | "config_change"
  | "rotation"
  | "cleanup"
  | "query";

export type DecayLogFormat = "json" | "text";

export type DecayLogRecord = {
  id: number;
  timestamp: number;
  level: DecayLogLevel;
  event: DecayLogEventType;
  message: string;
  context: Record<string, unknown>;
};

export type DecayLogOutputConfig = {
  console: boolean;
  file: boolean;
  remote: boolean;
};

export type DecayLogFileConfig = {
  path: string;
  maxFileSizeBytes: number;
  maxFiles: number;
};

export type DecayLogConfig = {
  enabled: boolean;
  minLevel: DecayLogLevel;
  format: DecayLogFormat;
  maxInMemoryRecords: number;
  outputs: DecayLogOutputConfig;
  file: DecayLogFileConfig;
};

export type DecayLogConfigInput = {
  enabled?: boolean;
  minLevel?: DecayLogLevel;
  format?: DecayLogFormat;
  maxInMemoryRecords?: number;
  outputs?: Partial<DecayLogOutputConfig>;
  file?: Partial<DecayLogFileConfig>;
};

export type DecayLogQuery = {
  level?: DecayLogLevel;
  event?: DecayLogEventType;
  fromTime?: number;
  toTime?: number;
  containsText?: string;
  limit?: number;
  order?: "asc" | "desc";
};

/**
 * Thresholds and rules for performance alert evaluation.
 */
export type DecayPerformanceAlertThresholds = {
  latencyMs: number;
  errorRate: number;
  memoryUsageMb: number;
  stateTransitionChangeRate: number;
  stateTransitionFlipCount: number;
  evaluationWindowMs: number;
};

export type DecayPerformanceAlertRules = {
  enabled: Record<DecayAlertMetric, boolean>;
  thresholds: DecayPerformanceAlertThresholds;
};

export type DecayPerformanceAlert = {
  id: string;
  metric: DecayAlertMetric;
  severity: DecayAlertSeverity;
  state: DecayAlertState;
  message: string;
  triggeredAt: number;
  updatedAt: number;
  silencedUntil: number | null;
  context: Record<string, number | string | boolean>;
};

export type DecayPerformanceAlertHistoryEntry = {
  id: string;
  event: DecayAlertEventType;
  metric: DecayAlertMetric;
  severity: DecayAlertSeverity;
  at: number;
  message: string;
  context: Record<string, number | string | boolean>;
};

export type DecayPerformanceAlertNotification = {
  event: DecayAlertEventType;
  alert: DecayPerformanceAlert;
};

export type DecayPerformanceMonitoringSnapshot = {
  generatedAt: number;
  rules: DecayPerformanceAlertRules;
  activeAlerts: Record<DecayAlertMetric, DecayPerformanceAlert | null>;
  historyCount: number;
  latestHistory: DecayPerformanceAlertHistoryEntry[];
};

/**
 * Per-function execution timing/counter aggregate.
 */
export type DecayMetricFunctionStats = {
  count: number;
  totalDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  averageDurationMs: number;
  lastDurationMs: number;
};

/**
 * Score delta aggregate for compute runs.
 */
export type DecayMetricScoreChangeStats = {
  totalDelta: number;
  minDelta: number;
  maxDelta: number;
  averageDelta: number;
  increasedCount: number;
  decreasedCount: number;
  unchangedCount: number;
  lastDelta: number;
};

/**
 * State transition counters from one lifecycle state to another.
 */
export type DecayMetricStateTransitionStats = {
  totalTransitions: number;
  changedTransitions: number;
  byTransition: Record<string, number>;
};

/**
 * Error aggregate for algorithm runtime.
 */
export type DecayMetricErrorStats = {
  totalErrors: number;
  byFunction: Record<string, number>;
  lastError: {
    functionName: string;
    name: string;
    message: string;
    at: number;
  } | null;
};

/**
 * Full algorithm metrics snapshot exported to callers.
 */
export type DecayAlgorithmMetricsSnapshot = {
  initializedAt: number;
  lastResetAt: number;
  computationCount: number;
  frequency: {
    windowMs: number;
    computationsInWindow: number;
    computationsPerSecond: number;
    computationsPerMinute: number;
  };
  durations: {
    overall: DecayMetricFunctionStats;
    byFunction: Record<string, DecayMetricFunctionStats>;
  };
  scoreChanges: DecayMetricScoreChangeStats;
  stateTransitions: DecayMetricStateTransitionStats;
  errors: DecayMetricErrorStats;
};

/**
 * Human-readable report wrapper with generated timestamp.
 */
export type DecayAlgorithmMetricsReport = {
  generatedAt: number;
  metrics: DecayAlgorithmMetricsSnapshot;
};

type MutableDurationStats = {
  count: number;
  totalDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  lastDurationMs: number;
};

type MutableScoreChangeStats = {
  count: number;
  totalDelta: number;
  minDelta: number;
  maxDelta: number;
  increasedCount: number;
  decreasedCount: number;
  unchangedCount: number;
  lastDelta: number;
};

type MutableTransitionStats = {
  totalTransitions: number;
  changedTransitions: number;
  byTransition: Record<string, number>;
};

type StateTransitionEvent = {
  from: DecayStatus;
  to: DecayStatus;
  at: number;
};

type MutableErrorStats = {
  totalErrors: number;
  byFunction: Record<string, number>;
  lastError: {
    functionName: string;
    name: string;
    message: string;
    at: number;
  } | null;
};

type MutableMetricsState = {
  initializedAt: number;
  lastResetAt: number;
  computationCount: number;
  computationTimestamps: number[];
  computeErrorTimestamps: number[];
  transitionEvents: StateTransitionEvent[];
  durationsByFunction: Record<string, MutableDurationStats>;
  overallDuration: MutableDurationStats;
  scoreChanges: MutableScoreChangeStats;
  stateTransitions: MutableTransitionStats;
  errors: MutableErrorStats;
};

type MutableAlertState = {
  rules: DecayPerformanceAlertRules;
  activeAlerts: Partial<Record<DecayAlertMetric, DecayPerformanceAlert>>;
  history: DecayPerformanceAlertHistoryEntry[];
  listeners: Array<(notification: DecayPerformanceAlertNotification) => void>;
  silencedUntilByMetric: Partial<Record<DecayAlertMetric, number>>;
};

type MutableLogState = {
  config: DecayLogConfig;
  records: DecayLogRecord[];
  nextId: number;
  remoteListeners: Array<(record: DecayLogRecord) => void>;
};

const DEFAULT_ALERT_RULES: DecayPerformanceAlertRules = {
  enabled: {
    latency: true,
    error_rate: true,
    memory_usage: true,
    state_transition_anomaly: true,
  },
  thresholds: {
    latencyMs: 100,
    errorRate: 0.2,
    memoryUsageMb: 256,
    stateTransitionChangeRate: 0.4,
    stateTransitionFlipCount: 8,
    evaluationWindowMs: FREQUENCY_WINDOW_MS,
  },
};

const DEFAULT_LOG_CONFIG: DecayLogConfig = {
  enabled: true,
  minLevel: "info",
  format: "json",
  maxInMemoryRecords: 2000,
  outputs: {
    console: true,
    file: false,
    remote: false,
  },
  file: {
    path: DEFAULT_LOG_FILE_PATH,
    maxFileSizeBytes: 5 * 1024 * 1024,
    maxFiles: 5,
  },
};

function createEmptyDurationStats(): MutableDurationStats {
  return {
    count: 0,
    totalDurationMs: 0,
    minDurationMs: Number.POSITIVE_INFINITY,
    maxDurationMs: 0,
    lastDurationMs: 0,
  };
}

function createEmptyScoreChangeStats(): MutableScoreChangeStats {
  return {
    count: 0,
    totalDelta: 0,
    minDelta: Number.POSITIVE_INFINITY,
    maxDelta: Number.NEGATIVE_INFINITY,
    increasedCount: 0,
    decreasedCount: 0,
    unchangedCount: 0,
    lastDelta: 0,
  };
}

function createEmptyTransitionStats(): MutableTransitionStats {
  const byTransition: Record<string, number> = {};

  for (const from of STATUS_VALUES) {
    for (const to of STATUS_VALUES) {
      byTransition[`${from}->${to}`] = 0;
    }
  }

  return {
    totalTransitions: 0,
    changedTransitions: 0,
    byTransition,
  };
}

function createEmptyErrorStats(): MutableErrorStats {
  return {
    totalErrors: 0,
    byFunction: {},
    lastError: null,
  };
}

function createEmptyMetricsState(now: number): MutableMetricsState {
  return {
    initializedAt: now,
    lastResetAt: now,
    computationCount: 0,
    computationTimestamps: [],
    computeErrorTimestamps: [],
    transitionEvents: [],
    durationsByFunction: {},
    overallDuration: createEmptyDurationStats(),
    scoreChanges: createEmptyScoreChangeStats(),
    stateTransitions: createEmptyTransitionStats(),
    errors: createEmptyErrorStats(),
  };
}

const algorithmMetricsState: MutableMetricsState = createEmptyMetricsState(Date.now());

const performanceAlertState: MutableAlertState = {
  rules: {
    enabled: { ...DEFAULT_ALERT_RULES.enabled },
    thresholds: { ...DEFAULT_ALERT_RULES.thresholds },
  },
  activeAlerts: {},
  history: [],
  listeners: [],
  silencedUntilByMetric: {},
};

const logState: MutableLogState = {
  config: {
    enabled: DEFAULT_LOG_CONFIG.enabled,
    minLevel: DEFAULT_LOG_CONFIG.minLevel,
    format: DEFAULT_LOG_CONFIG.format,
    maxInMemoryRecords: DEFAULT_LOG_CONFIG.maxInMemoryRecords,
    outputs: { ...DEFAULT_LOG_CONFIG.outputs },
    file: { ...DEFAULT_LOG_CONFIG.file },
  },
  records: [],
  nextId: 1,
  remoteListeners: [],
};

function cloneLogConfig(): DecayLogConfig {
  return {
    enabled: logState.config.enabled,
    minLevel: logState.config.minLevel,
    format: logState.config.format,
    maxInMemoryRecords: logState.config.maxInMemoryRecords,
    outputs: { ...logState.config.outputs },
    file: { ...logState.config.file },
  };
}

function toLogErrorContext(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack ?? "",
    };
  }

  return {
    errorName: "NonError",
    errorMessage: String(error),
  };
}

function normalizeLogContext(context: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!context) {
    return {};
  }

  return { ...context };
}

function shouldWriteLog(level: DecayLogLevel): boolean {
  if (!logState.config.enabled) {
    return false;
  }

  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[logState.config.minLevel];
}

function formatLogLine(record: DecayLogRecord): string {
  if (logState.config.format === "text") {
    const ts = new Date(record.timestamp).toISOString();
    const contextText = JSON.stringify(record.context);
    return `${ts} [${record.level}] [${record.event}] ${record.message} ${contextText}`;
  }

  return JSON.stringify(record);
}

function enforceLogRecordLimit(): void {
  const maxRecords = Math.max(1, Math.min(MAX_LOG_BUFFER, Math.floor(logState.config.maxInMemoryRecords)));
  if (logState.records.length > maxRecords) {
    logState.records.splice(0, logState.records.length - maxRecords);
  }
}

function writeLogToConsole(record: DecayLogRecord): void {
  const line = formatLogLine(record);
  if (record.level === "error") {
    console.error(line);
    return;
  }
  if (record.level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

function buildRotatedPath(basePath: string, index: number): string {
  return `${basePath}.${index}`;
}

function cleanupRotatedFiles(filePath: string, maxFiles: number): number {
  let deleted = 0;
  let index = Math.max(1, maxFiles);

  while (true) {
    const candidate = buildRotatedPath(filePath, index);
    if (!existsSync(candidate)) {
      break;
    }
    unlinkSync(candidate);
    deleted += 1;
    index += 1;
  }

  return deleted;
}

function rotateLogFileIfNeeded(filePath: string, incomingSize: number): void {
  const maxFileSizeBytes = Math.max(1024, Math.floor(logState.config.file.maxFileSizeBytes));
  const maxFiles = Math.max(1, Math.floor(logState.config.file.maxFiles));

  if (!existsSync(filePath)) {
    return;
  }

  const currentSize = statSync(filePath).size;
  if (currentSize + incomingSize < maxFileSizeBytes) {
    return;
  }

  if (maxFiles <= 1) {
    writeFileSync(filePath, "", { encoding: "utf8" });
    return;
  }

  const oldestArchive = buildRotatedPath(filePath, maxFiles - 1);
  if (existsSync(oldestArchive)) {
    unlinkSync(oldestArchive);
  }

  for (let index = maxFiles - 2; index >= 1; index -= 1) {
    const source = buildRotatedPath(filePath, index);
    const target = buildRotatedPath(filePath, index + 1);
    if (existsSync(source)) {
      renameSync(source, target);
    }
  }

  renameSync(filePath, buildRotatedPath(filePath, 1));
}

function writeLogToFile(record: DecayLogRecord): void {
  const filePath = logState.config.file.path;
  const directory = dirname(filePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  const line = `${formatLogLine(record)}\n`;
  rotateLogFileIfNeeded(filePath, line.length);
  appendFileSync(filePath, line, { encoding: "utf8" });
  cleanupRotatedFiles(filePath, Math.max(1, Math.floor(logState.config.file.maxFiles)));
}

function writeLogToRemote(record: DecayLogRecord): void {
  for (const listener of logState.remoteListeners) {
    try {
      listener({ ...record, context: { ...record.context } });
    } catch (_error) {
      // Remote sink failures must not break algorithm execution.
    }
  }
}

function writeStructuredLog(
  level: DecayLogLevel,
  event: DecayLogEventType,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (!LOG_EVENT_TYPES.includes(event)) {
    return;
  }

  if (!shouldWriteLog(level)) {
    return;
  }

  const record: DecayLogRecord = {
    id: logState.nextId,
    timestamp: Date.now(),
    level,
    event,
    message,
    context: normalizeLogContext(context),
  };
  logState.nextId += 1;

  logState.records.push(record);
  enforceLogRecordLimit();

  try {
    if (logState.config.outputs.console) {
      writeLogToConsole(record);
    }
    if (logState.config.outputs.file) {
      writeLogToFile(record);
    }
    if (logState.config.outputs.remote) {
      writeLogToRemote(record);
    }
  } catch (error) {
    const fallback: DecayLogRecord = {
      id: logState.nextId,
      timestamp: Date.now(),
      level: "error",
      event: "error",
      message: "log pipeline failed",
      context: {
        sourceEvent: event,
        ...toLogErrorContext(error),
      },
    };
    logState.nextId += 1;
    logState.records.push(fallback);
    enforceLogRecordLimit();
    console.error(formatLogLine(fallback));
  }
}

function pruneFrequencySamples(now: number): void {
  const cutoff = now - FREQUENCY_WINDOW_MS;
  const samples = algorithmMetricsState.computationTimestamps;
  let firstValidIndex = 0;

  while (firstValidIndex < samples.length) {
    const sample = samples[firstValidIndex];
    if (sample === undefined || sample >= cutoff) {
      break;
    }
    firstValidIndex += 1;
  }

  if (firstValidIndex > 0) {
    samples.splice(0, firstValidIndex);
  }

  if (samples.length > MAX_FREQUENCY_SAMPLES) {
    samples.splice(0, samples.length - MAX_FREQUENCY_SAMPLES);
  }
}

function pruneTimestampArray(samples: number[], cutoff: number, maxSize: number): void {
  let firstValidIndex = 0;
  while (firstValidIndex < samples.length) {
    const sample = samples[firstValidIndex];
    if (sample === undefined || sample >= cutoff) {
      break;
    }
    firstValidIndex += 1;
  }

  if (firstValidIndex > 0) {
    samples.splice(0, firstValidIndex);
  }

  if (samples.length > maxSize) {
    samples.splice(0, samples.length - maxSize);
  }
}

function cloneAlertRules(): DecayPerformanceAlertRules {
  return {
    enabled: { ...performanceAlertState.rules.enabled },
    thresholds: { ...performanceAlertState.rules.thresholds },
  };
}

function recordComputation(now: number): void {
  algorithmMetricsState.computationCount += 1;
  algorithmMetricsState.computationTimestamps.push(now);
  pruneFrequencySamples(now);
  writeStructuredLog("debug", "calculation_step", "computation sample recorded", {
    computationCount: algorithmMetricsState.computationCount,
    windowSize: algorithmMetricsState.computationTimestamps.length,
    at: now,
  });
}

function getOrCreateDurationStats(functionName: string): MutableDurationStats {
  const existing = algorithmMetricsState.durationsByFunction[functionName];
  if (existing) {
    return existing;
  }

  const created = createEmptyDurationStats();
  algorithmMetricsState.durationsByFunction[functionName] = created;
  return created;
}

function updateDurationStats(stats: MutableDurationStats, durationMs: number): void {
  stats.count += 1;
  stats.totalDurationMs += durationMs;
  stats.lastDurationMs = durationMs;

  if (durationMs < stats.minDurationMs) {
    stats.minDurationMs = durationMs;
  }

  if (durationMs > stats.maxDurationMs) {
    stats.maxDurationMs = durationMs;
  }
}

function recordDuration(functionName: string, durationMs: number): void {
  const normalizedDurationMs = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
  updateDurationStats(getOrCreateDurationStats(functionName), normalizedDurationMs);
  updateDurationStats(algorithmMetricsState.overallDuration, normalizedDurationMs);
  writeStructuredLog("debug", "performance_metric", "function duration recorded", {
    functionName,
    durationMs: normalizedDurationMs,
  });
}

function recordScoreChange(previousScore: number, nextScore: number): void {
  const delta = nextScore - previousScore;
  const scoreChanges = algorithmMetricsState.scoreChanges;

  scoreChanges.count += 1;
  scoreChanges.totalDelta += delta;
  scoreChanges.lastDelta = delta;

  if (delta < scoreChanges.minDelta) {
    scoreChanges.minDelta = delta;
  }

  if (delta > scoreChanges.maxDelta) {
    scoreChanges.maxDelta = delta;
  }

  if (delta > 0) {
    scoreChanges.increasedCount += 1;
  } else if (delta < 0) {
    scoreChanges.decreasedCount += 1;
  } else {
    scoreChanges.unchangedCount += 1;
  }

  writeStructuredLog("info", "score_change", "score change recorded", {
    previousScore,
    nextScore,
    delta,
    increasedCount: scoreChanges.increasedCount,
    decreasedCount: scoreChanges.decreasedCount,
    unchangedCount: scoreChanges.unchangedCount,
  });
}

function recordStateTransition(previousStatus: DecayStatus, nextStatus: DecayStatus, at: number): void {
  const transitions = algorithmMetricsState.stateTransitions;
  const transitionKey = `${previousStatus}->${nextStatus}`;

  transitions.totalTransitions += 1;
  transitions.byTransition[transitionKey] = (transitions.byTransition[transitionKey] ?? 0) + 1;
  algorithmMetricsState.transitionEvents.push({ from: previousStatus, to: nextStatus, at });

  if (previousStatus !== nextStatus) {
    transitions.changedTransitions += 1;
  }

  writeStructuredLog("info", "state_transition", "state transition recorded", {
    previousStatus,
    nextStatus,
    changed: previousStatus !== nextStatus,
    totalTransitions: transitions.totalTransitions,
    changedTransitions: transitions.changedTransitions,
    at,
  });
}

function recordError(functionName: string, error: unknown): void {
  const now = Date.now();
  const errors = algorithmMetricsState.errors;
  errors.totalErrors += 1;
  errors.byFunction[functionName] = (errors.byFunction[functionName] ?? 0) + 1;

  // computeDecayScore errors drive error-rate alert evaluation.
  if (functionName === "computeDecayScore") {
    algorithmMetricsState.computeErrorTimestamps.push(now);
  }

  if (error instanceof Error) {
    errors.lastError = {
      functionName,
      name: error.name,
      message: error.message,
      at: now,
    };
    return;
  }

  errors.lastError = {
    functionName,
    name: "NonError",
    message: String(error),
    at: now,
  };

  writeStructuredLog("error", "error", "algorithm error recorded", {
    functionName,
    ...toLogErrorContext(error),
  });
}

function toPublicDurationStats(stats: MutableDurationStats): DecayMetricFunctionStats {
  return {
    count: stats.count,
    totalDurationMs: stats.totalDurationMs,
    minDurationMs: stats.count > 0 ? stats.minDurationMs : 0,
    maxDurationMs: stats.maxDurationMs,
    averageDurationMs: stats.count > 0 ? stats.totalDurationMs / stats.count : 0,
    lastDurationMs: stats.lastDurationMs,
  };
}

function toPublicScoreChangeStats(stats: MutableScoreChangeStats): DecayMetricScoreChangeStats {
  return {
    totalDelta: stats.totalDelta,
    minDelta: stats.count > 0 ? stats.minDelta : 0,
    maxDelta: stats.count > 0 ? stats.maxDelta : 0,
    averageDelta: stats.count > 0 ? stats.totalDelta / stats.count : 0,
    increasedCount: stats.increasedCount,
    decreasedCount: stats.decreasedCount,
    unchangedCount: stats.unchangedCount,
    lastDelta: stats.lastDelta,
  };
}

function buildMetricsSnapshot(now: number): DecayAlgorithmMetricsSnapshot {
  pruneFrequencySamples(now);
  const computationsInWindow = algorithmMetricsState.computationTimestamps.length;
  const durationsByFunction: Record<string, DecayMetricFunctionStats> = {};

  for (const [functionName, stats] of Object.entries(algorithmMetricsState.durationsByFunction)) {
    durationsByFunction[functionName] = toPublicDurationStats(stats);
  }

  return {
    initializedAt: algorithmMetricsState.initializedAt,
    lastResetAt: algorithmMetricsState.lastResetAt,
    computationCount: algorithmMetricsState.computationCount,
    frequency: {
      windowMs: FREQUENCY_WINDOW_MS,
      computationsInWindow,
      computationsPerSecond: computationsInWindow / (FREQUENCY_WINDOW_MS / 1_000),
      computationsPerMinute: computationsInWindow / (FREQUENCY_WINDOW_MS / 60_000),
    },
    durations: {
      overall: toPublicDurationStats(algorithmMetricsState.overallDuration),
      byFunction: durationsByFunction,
    },
    scoreChanges: toPublicScoreChangeStats(algorithmMetricsState.scoreChanges),
    stateTransitions: {
      totalTransitions: algorithmMetricsState.stateTransitions.totalTransitions,
      changedTransitions: algorithmMetricsState.stateTransitions.changedTransitions,
      byTransition: { ...algorithmMetricsState.stateTransitions.byTransition },
    },
    errors: {
      totalErrors: algorithmMetricsState.errors.totalErrors,
      byFunction: { ...algorithmMetricsState.errors.byFunction },
      lastError: algorithmMetricsState.errors.lastError ? { ...algorithmMetricsState.errors.lastError } : null,
    },
  };
}

function pushAlertHistory(entry: DecayPerformanceAlertHistoryEntry): void {
  performanceAlertState.history.push(entry);
  if (performanceAlertState.history.length > MAX_ALERT_HISTORY) {
    performanceAlertState.history.splice(0, performanceAlertState.history.length - MAX_ALERT_HISTORY);
  }
}

function notifyAlertListeners(event: DecayAlertEventType, alert: DecayPerformanceAlert): void {
  for (const listener of performanceAlertState.listeners) {
    try {
      listener({ event, alert: { ...alert, context: { ...alert.context } } });
    } catch (_error) {
      // Listener failures must not break decay score path.
    }
  }
}

function getMemoryUsageMb(): number {
  if (typeof process === "undefined" || typeof process.memoryUsage !== "function") {
    return 0;
  }

  const usage = process.memoryUsage();
  const bytes = usage.heapUsed ?? 0;
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return 0;
  }

  return bytes / (1024 * 1024);
}

function countTransitionFlips(events: StateTransitionEvent[]): number {
  let flips = 0;
  let previous: StateTransitionEvent | null = null;

  for (const current of events) {
    const isReversePair =
      previous !== null &&
      previous.from === current.to &&
      previous.to === current.from &&
      previous.from !== previous.to &&
      current.from !== current.to;

    if (isReversePair) {
      flips += 1;
    }

    previous = current;
  }

  return flips;
}

function evaluateAlertMetric(
  metric: DecayAlertMetric,
  violated: boolean,
  severity: DecayAlertSeverity,
  message: string,
  context: Record<string, number | string | boolean>,
  now: number,
): void {
  if (!performanceAlertState.rules.enabled[metric]) {
    return;
  }

  const storedSilencedUntil = performanceAlertState.silencedUntilByMetric[metric] ?? null;
  if (storedSilencedUntil !== null && storedSilencedUntil <= now) {
    delete performanceAlertState.silencedUntilByMetric[metric];
  }

  const silencedUntil = performanceAlertState.silencedUntilByMetric[metric] ?? null;
  const isSilenced = silencedUntil !== null && silencedUntil > now;
  const existing = performanceAlertState.activeAlerts[metric];

  if (!violated) {
    if (!existing) {
      return;
    }

    delete performanceAlertState.activeAlerts[metric];
    pushAlertHistory({
      id: existing.id,
      event: "recovered",
      metric,
      severity: existing.severity,
      at: now,
      message: `${metric} alert recovered`,
      context: { ...existing.context },
    });
    notifyAlertListeners("recovered", existing);
    return;
  }

  if (existing) {
    existing.severity = severity;
    existing.message = message;
    existing.updatedAt = now;
    existing.context = { ...context };
    existing.state = isSilenced ? "silenced" : "active";
    existing.silencedUntil = silencedUntil;

    pushAlertHistory({
      id: existing.id,
      event: "updated",
      metric,
      severity,
      at: now,
      message,
      context: { ...context },
    });

    if (!isSilenced) {
      notifyAlertListeners("updated", existing);
    }

    return;
  }

  const created: DecayPerformanceAlert = {
    id: `${metric}-${now}`,
    metric,
    severity,
    state: isSilenced ? "silenced" : "active",
    message,
    triggeredAt: now,
    updatedAt: now,
    silencedUntil,
    context: { ...context },
  };

  performanceAlertState.activeAlerts[metric] = created;
  pushAlertHistory({
    id: created.id,
    event: "triggered",
    metric,
    severity,
    at: now,
    message,
    context: { ...context },
  });

  if (!isSilenced) {
    notifyAlertListeners("triggered", created);
  }
}

function evaluatePerformanceAlerts(now: number): void {
  const thresholds = performanceAlertState.rules.thresholds;
  const windowMs = Math.max(1, thresholds.evaluationWindowMs);
  const cutoff = now - windowMs;

  pruneFrequencySamples(now);
  pruneTimestampArray(algorithmMetricsState.computeErrorTimestamps, cutoff, MAX_FREQUENCY_SAMPLES);
  algorithmMetricsState.transitionEvents = algorithmMetricsState.transitionEvents.filter((item) => item.at >= cutoff);

  const computeDuration = algorithmMetricsState.durationsByFunction.computeDecayScore;
  const latencyMs = computeDuration?.lastDurationMs ?? 0;
  evaluateAlertMetric(
    "latency",
    latencyMs > thresholds.latencyMs,
    latencyMs > thresholds.latencyMs * 2 ? "critical" : "warning",
    `computeDecayScore latency ${latencyMs.toFixed(2)}ms exceeds threshold ${thresholds.latencyMs.toFixed(2)}ms`,
    { latencyMs, thresholdMs: thresholds.latencyMs },
    now,
  );

  const computationsInWindow = algorithmMetricsState.computationTimestamps.length;
  const computeErrorsInWindow = algorithmMetricsState.computeErrorTimestamps.length;
  const errorRate = computationsInWindow > 0 ? computeErrorsInWindow / computationsInWindow : 0;
  evaluateAlertMetric(
    "error_rate",
    errorRate > thresholds.errorRate,
    errorRate > thresholds.errorRate * 2 ? "critical" : "warning",
    `computeDecayScore error rate ${(errorRate * 100).toFixed(2)}% exceeds threshold ${(thresholds.errorRate * 100).toFixed(2)}%`,
    {
      errorRate,
      thresholdRate: thresholds.errorRate,
      computeErrorsInWindow,
      computationsInWindow,
    },
    now,
  );

  const memoryUsageMb = getMemoryUsageMb();
  evaluateAlertMetric(
    "memory_usage",
    memoryUsageMb > thresholds.memoryUsageMb,
    memoryUsageMb > thresholds.memoryUsageMb * 1.5 ? "critical" : "warning",
    `heap usage ${memoryUsageMb.toFixed(2)}MB exceeds threshold ${thresholds.memoryUsageMb.toFixed(2)}MB`,
    { memoryUsageMb, thresholdMb: thresholds.memoryUsageMb },
    now,
  );

  const transitionEvents = algorithmMetricsState.transitionEvents;
  const changedCount = transitionEvents.filter((item) => item.from !== item.to).length;
  const transitionChangeRate = transitionEvents.length > 0 ? changedCount / transitionEvents.length : 0;
  const transitionFlipCount = countTransitionFlips(transitionEvents);
  const isTransitionAnomaly =
    transitionChangeRate > thresholds.stateTransitionChangeRate ||
    transitionFlipCount >= thresholds.stateTransitionFlipCount;

  evaluateAlertMetric(
    "state_transition_anomaly",
    isTransitionAnomaly,
    transitionFlipCount >= thresholds.stateTransitionFlipCount ? "critical" : "warning",
    `state transition anomaly detected (changeRate=${transitionChangeRate.toFixed(2)}, flips=${transitionFlipCount})`,
    {
      transitionChangeRate,
      thresholdChangeRate: thresholds.stateTransitionChangeRate,
      transitionFlipCount,
      thresholdFlipCount: thresholds.stateTransitionFlipCount,
      transitionsInWindow: transitionEvents.length,
    },
    now,
  );

  writeStructuredLog("debug", "performance_metric", "performance metrics evaluated", {
    latencyMs,
    computationsInWindow,
    computeErrorsInWindow,
    errorRate,
    memoryUsageMb,
    transitionChangeRate,
    transitionFlipCount,
    windowMs,
  });
}

/**
 * Read effective structured log config.
 */
export function getDecayAlgorithmLogConfig(): DecayLogConfig {
  return cloneLogConfig();
}

/**
 * Update logger config for output routing and retention limits.
 */
export function updateDecayAlgorithmLogConfig(next: DecayLogConfigInput): DecayLogConfig {
  if (next.enabled !== undefined) {
    logState.config.enabled = next.enabled;
  }
  if (next.minLevel && LOG_LEVELS.includes(next.minLevel)) {
    logState.config.minLevel = next.minLevel;
  }
  if (next.format && (next.format === "json" || next.format === "text")) {
    logState.config.format = next.format;
  }
  if (next.maxInMemoryRecords !== undefined && Number.isFinite(next.maxInMemoryRecords)) {
    logState.config.maxInMemoryRecords = Math.max(1, Math.floor(next.maxInMemoryRecords));
  }

  if (next.outputs) {
    if (typeof next.outputs.console === "boolean") {
      logState.config.outputs.console = next.outputs.console;
    }
    if (typeof next.outputs.file === "boolean") {
      logState.config.outputs.file = next.outputs.file;
    }
    if (typeof next.outputs.remote === "boolean") {
      logState.config.outputs.remote = next.outputs.remote;
    }
  }

  if (next.file) {
    if (typeof next.file.path === "string" && next.file.path.trim().length > 0) {
      logState.config.file.path = next.file.path;
    }
    if (next.file.maxFileSizeBytes !== undefined && Number.isFinite(next.file.maxFileSizeBytes)) {
      logState.config.file.maxFileSizeBytes = Math.max(1024, Math.floor(next.file.maxFileSizeBytes));
    }
    if (next.file.maxFiles !== undefined && Number.isFinite(next.file.maxFiles)) {
      logState.config.file.maxFiles = Math.max(1, Math.floor(next.file.maxFiles));
    }
  }

  enforceLogRecordLimit();
  writeStructuredLog("info", "config_change", "decay algorithm log config updated", {
    config: cloneLogConfig(),
  });
  return cloneLogConfig();
}

/**
 * Subscribe structured logs for remote forwarding pipelines.
 */
export function subscribeDecayAlgorithmLogs(listener: (record: DecayLogRecord) => void): () => void {
  logState.remoteListeners.push(listener);
  return () => {
    const index = logState.remoteListeners.indexOf(listener);
    if (index >= 0) {
      logState.remoteListeners.splice(index, 1);
    }
  };
}

/**
 * Return current in-memory logs by query constraints.
 */
export function queryDecayAlgorithmLogs(query: DecayLogQuery = {}): DecayLogRecord[] {
  const fromTime = query.fromTime ?? Number.MIN_SAFE_INTEGER;
  const toTime = query.toTime ?? Number.MAX_SAFE_INTEGER;
  const containsText = query.containsText?.trim().toLowerCase() ?? "";
  const order = query.order ?? "desc";
  const limit = Math.max(0, Math.floor(query.limit ?? 200));

  const filtered = logState.records.filter((record) => {
    if (query.level && record.level !== query.level) {
      return false;
    }
    if (query.event && record.event !== query.event) {
      return false;
    }
    if (record.timestamp < fromTime || record.timestamp > toTime) {
      return false;
    }
    if (containsText.length > 0) {
      const haystack = `${record.message} ${JSON.stringify(record.context)}`.toLowerCase();
      if (!haystack.includes(containsText)) {
        return false;
      }
    }
    return true;
  });

  const ordered = order === "asc" ? filtered : [...filtered].reverse();
  const sliced = limit > 0 ? ordered.slice(0, limit) : [];
  writeStructuredLog("debug", "query", "decay algorithm logs queried", {
    matchedCount: filtered.length,
    returnedCount: sliced.length,
    order,
    level: query.level ?? null,
    event: query.event ?? null,
  });
  return sliced.map((record) => ({ ...record, context: { ...record.context } }));
}

/**
 * Cleanup in-memory logs and stale rotated files.
 */
export function cleanupDecayAlgorithmLogs(): { removedInMemory: number; removedFiles: number } {
  const removedInMemory = logState.records.length;
  logState.records.length = 0;
  const removedFiles = cleanupRotatedFiles(logState.config.file.path, Math.max(1, logState.config.file.maxFiles));
  writeStructuredLog("info", "cleanup", "decay algorithm logs cleaned", {
    removedInMemory,
    removedFiles,
  });
  return { removedInMemory, removedFiles };
}

/**
 * Read the current log file contents for diagnostics.
 */
export function getDecayAlgorithmLogFileText(): string {
  const filePath = logState.config.file.path;
  if (!existsSync(filePath)) {
    return "";
  }
  return readFileSync(filePath, { encoding: "utf8" });
}

/**
 * Export current algorithm metrics as immutable snapshot.
 */
export function getDecayAlgorithmMetrics(): DecayAlgorithmMetricsSnapshot {
  return buildMetricsSnapshot(Date.now());
}

/**
 * Build metrics report payload for external monitoring pipelines.
 */
export function getDecayAlgorithmMetricsReport(): DecayAlgorithmMetricsReport {
  return {
    generatedAt: Date.now(),
    metrics: getDecayAlgorithmMetrics(),
  };
}

/**
 * Export metrics as JSON string to simplify log/file shipping.
 */
export function exportDecayAlgorithmMetrics(pretty: boolean = false): string {
  const report = getDecayAlgorithmMetricsReport();
  return pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);
}

/**
 * Read performance alert rules and current alert state.
 */
export function getDecayPerformanceMonitoringSnapshot(historyLimit: number = 50): DecayPerformanceMonitoringSnapshot {
  const normalizedLimit = Math.max(0, Math.floor(historyLimit));
  const latestHistory = normalizedLimit > 0 ? performanceAlertState.history.slice(-normalizedLimit) : [];
  const cloneAlert = (alert: DecayPerformanceAlert | undefined): DecayPerformanceAlert | null => {
    if (!alert) {
      return null;
    }

    return {
      ...alert,
      context: { ...alert.context },
    };
  };

  const activeAlerts: Record<DecayAlertMetric, DecayPerformanceAlert | null> = {
    latency: cloneAlert(performanceAlertState.activeAlerts.latency),
    error_rate: cloneAlert(performanceAlertState.activeAlerts.error_rate),
    memory_usage: cloneAlert(performanceAlertState.activeAlerts.memory_usage),
    state_transition_anomaly: cloneAlert(performanceAlertState.activeAlerts.state_transition_anomaly),
  };

  return {
    generatedAt: Date.now(),
    rules: cloneAlertRules(),
    activeAlerts,
    historyCount: performanceAlertState.history.length,
    latestHistory: latestHistory.map((item) => ({ ...item, context: { ...item.context } })),
  };
}

/**
 * Update alert thresholds and metric enable switches.
 */
export function updateDecayPerformanceAlertRules(next: Partial<DecayPerformanceAlertRules>): DecayPerformanceAlertRules {
  if (next.enabled) {
    for (const metric of ALERT_METRICS) {
      const value = next.enabled[metric];
      if (typeof value === "boolean") {
        performanceAlertState.rules.enabled[metric] = value;
      }
    }
  }

  if (next.thresholds) {
    const candidate = next.thresholds;

    if (Number.isFinite(candidate.latencyMs) && candidate.latencyMs !== undefined) {
      performanceAlertState.rules.thresholds.latencyMs = Math.max(1, candidate.latencyMs);
    }
    if (Number.isFinite(candidate.errorRate) && candidate.errorRate !== undefined) {
      performanceAlertState.rules.thresholds.errorRate = clampScore(candidate.errorRate, 0, 1);
    }
    if (Number.isFinite(candidate.memoryUsageMb) && candidate.memoryUsageMb !== undefined) {
      performanceAlertState.rules.thresholds.memoryUsageMb = Math.max(1, candidate.memoryUsageMb);
    }
    if (Number.isFinite(candidate.stateTransitionChangeRate) && candidate.stateTransitionChangeRate !== undefined) {
      performanceAlertState.rules.thresholds.stateTransitionChangeRate = clampScore(
        candidate.stateTransitionChangeRate,
        0,
        1,
      );
    }
    if (Number.isFinite(candidate.stateTransitionFlipCount) && candidate.stateTransitionFlipCount !== undefined) {
      performanceAlertState.rules.thresholds.stateTransitionFlipCount = Math.max(
        1,
        Math.floor(candidate.stateTransitionFlipCount),
      );
    }
    if (Number.isFinite(candidate.evaluationWindowMs) && candidate.evaluationWindowMs !== undefined) {
      performanceAlertState.rules.thresholds.evaluationWindowMs = clampScore(
        candidate.evaluationWindowMs,
        1_000,
        FREQUENCY_WINDOW_MS,
      );
    }
  }

  return cloneAlertRules();
}

/**
 * Subscribe alert notifications for external integration (logs/webhook bridges).
 */
export function subscribeDecayPerformanceAlertNotifications(
  listener: (notification: DecayPerformanceAlertNotification) => void,
): () => void {
  performanceAlertState.listeners.push(listener);

  return () => {
    const index = performanceAlertState.listeners.indexOf(listener);
    if (index >= 0) {
      performanceAlertState.listeners.splice(index, 1);
    }
  };
}

/**
 * Silence one or all alert metrics for the given duration.
 */
export function silenceDecayPerformanceAlerts(metric?: DecayAlertMetric, durationMs: number = DEFAULT_ALERT_SILENCE_MS): void {
  const now = Date.now();
  const until = now + Math.max(1_000, durationMs);
  const targets = metric ? [metric] : [...ALERT_METRICS];

  for (const currentMetric of targets) {
    performanceAlertState.silencedUntilByMetric[currentMetric] = until;
    const existing = performanceAlertState.activeAlerts[currentMetric];
    if (!existing) {
      continue;
    }

    existing.state = "silenced";
    existing.silencedUntil = until;
    existing.updatedAt = now;

    pushAlertHistory({
      id: existing.id,
      event: "silenced",
      metric: currentMetric,
      severity: existing.severity,
      at: now,
      message: `alert silenced until ${new Date(until).toISOString()}`,
      context: { ...existing.context, silencedUntil: until },
    });
    notifyAlertListeners("silenced", existing);
  }
}

/**
 * Remove alert silence and re-enable notifications immediately.
 */
export function restoreDecayPerformanceAlerts(metric?: DecayAlertMetric): void {
  const now = Date.now();
  const targets = metric ? [metric] : [...ALERT_METRICS];

  for (const currentMetric of targets) {
    delete performanceAlertState.silencedUntilByMetric[currentMetric];
    const existing = performanceAlertState.activeAlerts[currentMetric];
    if (!existing) {
      continue;
    }

    existing.state = "active";
    existing.silencedUntil = null;
    existing.updatedAt = now;

    pushAlertHistory({
      id: existing.id,
      event: "unsilenced",
      metric: currentMetric,
      severity: existing.severity,
      at: now,
      message: "alert silence removed",
      context: { ...existing.context },
    });
    notifyAlertListeners("unsilenced", existing);
  }
}

/**
 * Return recent alert history for audits.
 */
export function getDecayPerformanceAlertHistory(limit: number = 100): DecayPerformanceAlertHistoryEntry[] {
  const normalizedLimit = Math.max(0, Math.floor(limit));
  const history = normalizedLimit > 0 ? performanceAlertState.history.slice(-normalizedLimit) : [];
  return history.map((item) => ({ ...item, context: { ...item.context } }));
}

/**
 * Reset counters while keeping module metrics collector active.
 */
export function resetDecayAlgorithmMetrics(): void {
  const now = Date.now();
  algorithmMetricsState.lastResetAt = now;
  algorithmMetricsState.computationCount = 0;
  algorithmMetricsState.computationTimestamps.length = 0;
  algorithmMetricsState.computeErrorTimestamps.length = 0;
  algorithmMetricsState.transitionEvents.length = 0;
  algorithmMetricsState.durationsByFunction = {};
  algorithmMetricsState.overallDuration = createEmptyDurationStats();
  algorithmMetricsState.scoreChanges = createEmptyScoreChangeStats();
  algorithmMetricsState.stateTransitions = createEmptyTransitionStats();
  algorithmMetricsState.errors = createEmptyErrorStats();

  performanceAlertState.activeAlerts = {};
  performanceAlertState.history.length = 0;
  performanceAlertState.silencedUntilByMetric = {};
}

/**
 * Cleanup metrics collector state.
 * Debug entry: call this if monitoring memory should be reclaimed explicitly.
 */
export function clearDecayAlgorithmMetrics(): void {
  const now = Date.now();
  const fresh = createEmptyMetricsState(now);

  algorithmMetricsState.initializedAt = fresh.initializedAt;
  algorithmMetricsState.lastResetAt = fresh.lastResetAt;
  algorithmMetricsState.computationCount = fresh.computationCount;
  algorithmMetricsState.computationTimestamps = fresh.computationTimestamps;
  algorithmMetricsState.computeErrorTimestamps = fresh.computeErrorTimestamps;
  algorithmMetricsState.transitionEvents = fresh.transitionEvents;
  algorithmMetricsState.durationsByFunction = fresh.durationsByFunction;
  algorithmMetricsState.overallDuration = fresh.overallDuration;
  algorithmMetricsState.scoreChanges = fresh.scoreChanges;
  algorithmMetricsState.stateTransitions = fresh.stateTransitions;
  algorithmMetricsState.errors = fresh.errors;

  performanceAlertState.activeAlerts = {};
  performanceAlertState.history.length = 0;
  performanceAlertState.silencedUntilByMetric = {};
}

/**
 * Calculate the time decay factor from elapsed time.
 *
 * The factor is always in [0.95, 1.0]:
 * - Recent access keeps factor close to 1.0.
 * - Long idle time pushes factor toward configured minimum.
 *
 * Debug guidance:
 * - If factor is unexpectedly low, inspect `elapsedMs` and `config.intervalMs`.
 * - If factor is out of range, verify `config.weights.minTimeDecayFactor`.
 */
export function calculateTimeDecayFactor(
  lastAccessTime: number,
  currentTime: number = Date.now(),
  configInput?: DecayConfigInput,
): number {
  const startedAt = Date.now();
  if (!Number.isFinite(lastAccessTime)) {
    const error = new TypeError("lastAccessTime must be a finite number");
    recordError("calculateTimeDecayFactor", error);
    recordDuration("calculateTimeDecayFactor", Date.now() - startedAt);
    throw error;
  }
  if (!Number.isFinite(currentTime)) {
    const error = new TypeError("currentTime must be a finite number");
    recordError("calculateTimeDecayFactor", error);
    recordDuration("calculateTimeDecayFactor", Date.now() - startedAt);
    throw error;
  }

  try {
    const config = resolveDecayConfig(configInput);
    const minFactor = config.weights.minTimeDecayFactor;
    if (!Number.isFinite(minFactor)) {
      throw new TypeError("config.weights.minTimeDecayFactor must be a finite number");
    }
    if (minFactor < 0.95 || minFactor > 1) {
      throw new RangeError("config.weights.minTimeDecayFactor must be within [0.95, 1.0]");
    }

    const elapsedMs = Math.max(0, currentTime - lastAccessTime);
    const decayRateMs = Math.max(1, config.intervalMs);

    // Exponential progress in [0, 1): larger elapsed time yields stronger decay.
    const decayProgress = 1 - Math.exp(-elapsedMs / decayRateMs);
    const factor = 1 - (1 - minFactor) * decayProgress;

    if (factor < minFactor) {
      writeStructuredLog("debug", "calculation_step", "time decay factor clamped to min", {
        lastAccessTime,
        currentTime,
        elapsedMs,
        decayRateMs,
        minFactor,
        factor,
      });
      return minFactor;
    }
    if (factor > 1) {
      writeStructuredLog("debug", "calculation_step", "time decay factor clamped to max", {
        lastAccessTime,
        currentTime,
        elapsedMs,
        decayRateMs,
        minFactor,
        factor,
      });
      return 1;
    }
    writeStructuredLog("debug", "calculation_step", "time decay factor calculated", {
      lastAccessTime,
      currentTime,
      elapsedMs,
      decayRateMs,
      minFactor,
      factor,
    });
    return factor;
  } catch (error) {
    recordError("calculateTimeDecayFactor", error);
    throw error;
  } finally {
    recordDuration("calculateTimeDecayFactor", Date.now() - startedAt);
  }
}

/**
 * Calculate usage-frequency boost from access count and recency.
 *
 * Boost is always in [0, 10]:
 * - More accesses increase the boost.
 * - Longer idle time lowers effective frequency and therefore lowers the boost.
 *
 * Debug guidance:
 * - If boost is too low, inspect `elapsedMs`, `config.intervalMs`, and `accessCount`.
 * - If boost saturates too early, inspect `frequencyPerWindow` and `maxBoost`.
 */
export function calculateUsageBoost(
  accessCount: number,
  lastAccessTime: number,
  currentTime: number = Date.now(),
  configInput?: DecayConfigInput,
): number {
  const startedAt = Date.now();
  if (!Number.isFinite(accessCount)) {
    const error = new TypeError("accessCount must be a finite number");
    recordError("calculateUsageBoost", error);
    recordDuration("calculateUsageBoost", Date.now() - startedAt);
    throw error;
  }
  if (accessCount < 0) {
    const error = new RangeError("accessCount must be >= 0");
    recordError("calculateUsageBoost", error);
    recordDuration("calculateUsageBoost", Date.now() - startedAt);
    throw error;
  }
  if (!Number.isFinite(lastAccessTime)) {
    const error = new TypeError("lastAccessTime must be a finite number");
    recordError("calculateUsageBoost", error);
    recordDuration("calculateUsageBoost", Date.now() - startedAt);
    throw error;
  }
  if (!Number.isFinite(currentTime)) {
    const error = new TypeError("currentTime must be a finite number");
    recordError("calculateUsageBoost", error);
    recordDuration("calculateUsageBoost", Date.now() - startedAt);
    throw error;
  }

  try {
    const config = resolveDecayConfig(configInput);
    const elapsedMs = Math.max(0, currentTime - lastAccessTime);
    const windowMs = Math.max(1, config.intervalMs);
    const maxBoost = Math.max(0, Math.min(10, config.weights.maxUsageBoost));

    // More recent activity has higher effective frequency per time window.
    const elapsedWindows = elapsedMs / windowMs;
    const frequencyPerWindow = accessCount / (1 + elapsedWindows);

    // Saturating normalization keeps output stable while preserving monotonicity.
    const normalizedFrequency = frequencyPerWindow / (frequencyPerWindow + 1);
    const boost = normalizedFrequency * maxBoost;

    writeStructuredLog("debug", "calculation_step", "usage boost calculated", {
      accessCount,
      lastAccessTime,
      currentTime,
      elapsedMs,
      windowMs,
      frequencyPerWindow,
      normalizedFrequency,
      maxBoost,
      boost,
    });

    return clampScore(boost, 0, 10);
  } catch (error) {
    recordError("calculateUsageBoost", error);
    throw error;
  } finally {
    recordDuration("calculateUsageBoost", Date.now() - startedAt);
  }
}

/**
 * Calculate structure-importance boost from link count and average link quality.
 *
 * Boost is always in [0, 5] (or [0, config.weights.maxStructureBoost] when lower):
 * - More links increase structural coverage and raise the boost.
 * - Higher average link weight (0-1) raises quality contribution.
 *
 * Debug guidance:
 * - If boost is always near zero, inspect `averageLinkWeight` and whether link weights are normalized to [0, 1].
 * - If boost saturates too fast, inspect `LINK_COUNT_SATURATION` and incoming `linkCount` scale.
 */
export function calculateStructureBoost(
  linkCount: number,
  averageLinkWeight: number,
  configInput?: DecayConfigInput,
): number {
  const startedAt = Date.now();
  if (!Number.isFinite(linkCount)) {
    const error = new TypeError("linkCount must be a finite number");
    recordError("calculateStructureBoost", error);
    recordDuration("calculateStructureBoost", Date.now() - startedAt);
    throw error;
  }
  if (linkCount < 0) {
    const error = new RangeError("linkCount must be >= 0");
    recordError("calculateStructureBoost", error);
    recordDuration("calculateStructureBoost", Date.now() - startedAt);
    throw error;
  }
  if (!Number.isFinite(averageLinkWeight)) {
    const error = new TypeError("averageLinkWeight must be a finite number");
    recordError("calculateStructureBoost", error);
    recordDuration("calculateStructureBoost", Date.now() - startedAt);
    throw error;
  }
  if (averageLinkWeight < 0 || averageLinkWeight > 1) {
    const error = new RangeError("averageLinkWeight must be within [0, 1]");
    recordError("calculateStructureBoost", error);
    recordDuration("calculateStructureBoost", Date.now() - startedAt);
    throw error;
  }

  try {
    const config = resolveDecayConfig(configInput);
    const maxBoost = Math.max(0, Math.min(5, config.weights.maxStructureBoost));

    // Saturation constant controls how quickly extra links approach max contribution.
    const LINK_COUNT_SATURATION = 5;
    const normalizedLinkCount = linkCount / (linkCount + LINK_COUNT_SATURATION);

    // Quality gates the structural contribution so low-quality link graphs get less boost.
    const qualityFactor = averageLinkWeight;
    const boost = normalizedLinkCount * qualityFactor * maxBoost;

    writeStructuredLog("debug", "calculation_step", "structure boost calculated", {
      linkCount,
      averageLinkWeight,
      maxBoost,
      normalizedLinkCount,
      qualityFactor,
      boost,
    });

    return clampScore(boost, 0, 5);
  } catch (error) {
    recordError("calculateStructureBoost", error);
    throw error;
  } finally {
    recordDuration("calculateStructureBoost", Date.now() - startedAt);
  }
}

/**
 * Validate score formula inputs and provide actionable debug errors.
 */
function validateScoreInput(
  baseScore: number,
  timeDecayFactor: number,
  usageBoost: number,
  structureBoost: number,
): void {
  if (!Number.isFinite(baseScore)) {
    throw new TypeError("baseScore must be a finite number");
  }

  if (!Number.isFinite(timeDecayFactor)) {
    throw new TypeError("timeDecayFactor must be a finite number");
  }
  if (timeDecayFactor < 0.95 || timeDecayFactor > 1) {
    throw new RangeError("timeDecayFactor must be within [0.95, 1.0]");
  }

  if (!Number.isFinite(usageBoost)) {
    throw new TypeError("usageBoost must be a finite number");
  }
  if (usageBoost < 0 || usageBoost > 10) {
    throw new RangeError("usageBoost must be within [0, 10]");
  }

  if (!Number.isFinite(structureBoost)) {
    throw new TypeError("structureBoost must be a finite number");
  }
  if (structureBoost < 0 || structureBoost > 5) {
    throw new RangeError("structureBoost must be within [0, 5]");
  }
}

/**
 * Clamp score into configured score range.
 */
function clampScore(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/**
 * Classify lifecycle state from score thresholds.
 */
export function classifyDecayStatus(score: number, configInput?: DecayConfigInput): DecayStatus {
  const startedAt = Date.now();
  try {
    const config = resolveDecayConfig(configInput);

    // Highest-priority branch: high score remains active.
    if (score >= config.thresholds.activeMinScore) {
      writeStructuredLog("debug", "calculation_step", "decay status classified", {
        score,
        status: "active",
        activeMinScore: config.thresholds.activeMinScore,
        coldMinScore: config.thresholds.coldMinScore,
      });
      return "active";
    }

    // Middle branch: score is not active but still above cold lower bound.
    if (score >= config.thresholds.coldMinScore) {
      writeStructuredLog("debug", "calculation_step", "decay status classified", {
        score,
        status: "cold",
        activeMinScore: config.thresholds.activeMinScore,
        coldMinScore: config.thresholds.coldMinScore,
      });
      return "cold";
    }

    // Fallback branch: anything below cold threshold becomes deprecated.
    writeStructuredLog("debug", "calculation_step", "decay status classified", {
      score,
      status: "deprecated",
      activeMinScore: config.thresholds.activeMinScore,
      coldMinScore: config.thresholds.coldMinScore,
    });
    return "deprecated";
  } catch (error) {
    recordError("classifyDecayStatus", error);
    throw error;
  } finally {
    recordDuration("classifyDecayStatus", Date.now() - startedAt);
  }
}

/**
 * Calculate memory score with the canonical formula:
 * score = base_score * time_decay_factor + usage_boost + structure_boost
 *
 * Debug guidance:
 * - If this throws, check upstream normalization for decay factor and boosts.
 * - If result is unexpected, inspect each input term before clamping.
 */
export function calculateMemoryScore(
  baseScore: number,
  timeDecayFactor: number,
  usageBoost: number,
  structureBoost: number,
): number {
  const startedAt = Date.now();
  try {
    validateScoreInput(baseScore, timeDecayFactor, usageBoost, structureBoost);
    const rawScore = baseScore * timeDecayFactor + usageBoost + structureBoost;
    writeStructuredLog("debug", "calculation_step", "memory score calculated", {
      baseScore,
      timeDecayFactor,
      usageBoost,
      structureBoost,
      rawScore,
    });
    return clampScore(rawScore, SCORE_MIN, SCORE_MAX);
  } catch (error) {
    recordError("calculateMemoryScore", error);
    throw error;
  } finally {
    recordDuration("calculateMemoryScore", Date.now() - startedAt);
  }
}

/**
 * Compute new score with formula:
 * score = base_score * time_decay_factor + usage_boost + structure_boost
 */
export function computeDecayScore(
  memory: DecayMemory,
  configInput?: DecayConfigInput,
  now: number = Date.now(),
): DecayComputationResult {
  const startedAt = Date.now();
  try {
    writeStructuredLog("info", "algorithm_start", "computeDecayScore started", {
      memoryKey: memory.key,
      now,
    });

    recordComputation(now);
    const config = resolveDecayConfig(configInput);
    const baseScore = memory.meta.score ?? DEFAULT_DECAY_CONFIG.maxScore / 2;
    const previousStatus = classifyDecayStatus(baseScore, config);
    const timeDecayFactor = calculateTimeDecayFactor(memory.meta.last_accessed_at, now, config);
    const usageBoost = calculateUsageBoost(memory.meta.access_count, memory.meta.last_accessed_at, now, config);

    const structuralDegree = memory.meta.in_degree + memory.meta.out_degree;
    const structureBoost = calculateStructureBoost(structuralDegree, 1, config);

    const formulaScore = calculateMemoryScore(baseScore, timeDecayFactor, usageBoost, structureBoost);
    const score = clampScore(formulaScore, config.minScore, config.maxScore);
    const status = classifyDecayStatus(score, config);

    writeStructuredLog("debug", "calculation_step", "computeDecayScore key calculations completed", {
      memoryKey: memory.key,
      baseScore,
      formulaScore,
      clampedScore: score,
      previousStatus,
      nextStatus: status,
      timeDecayFactor,
      usageBoost,
      structureBoost,
    });

    recordScoreChange(baseScore, score);
    recordStateTransition(previousStatus, status, now);
    evaluatePerformanceAlerts(now);

    writeStructuredLog("info", "algorithm_end", "computeDecayScore finished", {
      memoryKey: memory.key,
      status,
      score,
      durationMs: Date.now() - startedAt,
    });

    return {
      score,
      status,
      breakdown: {
        baseScore,
        timeDecayFactor,
        usageBoost,
        structureBoost,
      },
    };
  } catch (error) {
    recordError("computeDecayScore", error);
    evaluatePerformanceAlerts(Date.now());
    writeStructuredLog("error", "algorithm_end", "computeDecayScore failed", {
      memoryKey: memory.key,
      durationMs: Date.now() - startedAt,
      ...toLogErrorContext(error),
    });
    throw error;
  } finally {
    recordDuration("computeDecayScore", Date.now() - startedAt);
  }
}
