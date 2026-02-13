/**
 * Memory decay scheduler integration.
 * Bridges decay batch processing with the generic scheduler runtime.
 */

import { Database } from "bun:sqlite";

import { Scheduler } from "../scheduler";
import { computeDecayScore } from "./algorithm";
import {
  DEFAULT_DECAY_ALGORITHM_CONFIG,
  resolveDecayAlgorithmConfig,
  resolveDecayConfig,
  type DecayAlgorithmConfigInput,
} from "./config";
import {
  getMemoryVersion,
  processMemoriesInBatches,
  updateMemoryMetaWithOptimisticLock,
  type BatchMemoryRow,
} from "./processor";

const DEFAULT_MEMORY_DECAY_TASK_ID = "memory-decay";
const DEFAULT_DB_PATH = "kv.db";

type RecordValue = Record<string, unknown>;

/**
 * Runtime options for decay scheduler bootstrap.
 */
export type MemoryDecaySchedulerOptions = {
  mode: "http" | "mcp";
  dbPath?: string;
  taskId?: string;
  config?: DecayAlgorithmConfigInput;
};

/**
 * Control handles returned after scheduler bootstrap.
 */
export type MemoryDecaySchedulerRuntime = {
  scheduler: Scheduler;
  taskId: string;
  stop: () => void;
  runNow: () => Promise<void>;
};

/**
 * Build the executable task handler used by scheduler.
 * Debug entry: if periodic runs fail, start from this handler's logs.
 */
export function createMemoryDecayTaskExecutor(
  db: Database,
  mode: "http" | "mcp",
  configInput: DecayAlgorithmConfigInput = {},
): () => Promise<void> {
  return async (): Promise<void> => {
    await executeMemoryDecayTask(db, mode, configInput);
  };
}

/**
 * Execute one full decay pass.
 */
export async function executeMemoryDecayTask(
  db: Database,
  mode: "http" | "mcp",
  configInput: DecayAlgorithmConfigInput = {},
): Promise<void> {
  const algorithmConfig = resolveDecayAlgorithmConfig(configInput);
  const decayConfig = resolveDecayConfig({
    minScore: algorithmConfig.minScore,
    maxScore: algorithmConfig.maxScore,
    batchSize: algorithmConfig.scheduler.batchSize,
    intervalMs: algorithmConfig.scheduler.intervalMs,
    thresholds: algorithmConfig.thresholds,
    weights: {
      minTimeDecayFactor: algorithmConfig.timeDecay.minFactor,
      maxUsageBoost: algorithmConfig.usageBoost.maxBoost,
      maxStructureBoost: algorithmConfig.structureBoost.maxBoost,
    },
  });

  const startedAt = Date.now();
  console.info(
    `[decay.scheduler][${mode}] run started intervalMs=${algorithmConfig.scheduler.intervalMs} batchSize=${algorithmConfig.scheduler.batchSize}`,
  );

  try {
    const stats = await processMemoriesInBatches(
      db,
      {
        ...decayConfig,
      },
      algorithmConfig.scheduler.batchSize,
      async (memoryRow) => {
        await processMemoryRow(db, memoryRow, decayConfig, startedAt);
      },
    );

    const durationMs = Date.now() - startedAt;
    console.info(
      `[decay.scheduler][${mode}] run finished processed=${stats.processedMemories}/${stats.totalMemories} failedBatches=${stats.failedBatches} durationMs=${durationMs}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[decay.scheduler][${mode}] run failed: ${message}`);
    throw error;
  }
}

/**
 * Initialize scheduler, register decay task and start it.
 */
export function initializeMemoryDecayScheduler(
  options: MemoryDecaySchedulerOptions,
): MemoryDecaySchedulerRuntime {
  const config = resolveDecayAlgorithmConfig(options.config ?? {});
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const taskId = options.taskId ?? DEFAULT_MEMORY_DECAY_TASK_ID;
  const scheduler = new Scheduler();
  const db = new Database(dbPath);

  const runNow = createMemoryDecayTaskExecutor(db, options.mode, config);

  scheduler.registerTask({
    id: taskId,
    intervalMs: config.scheduler.intervalMs,
    handler: runNow,
  });
  scheduler.startTask(taskId);

  console.info(
    `[decay.scheduler][${options.mode}] initialized taskId=${taskId} intervalMs=${config.scheduler.intervalMs}`,
  );

  let stopped = false;

  return {
    scheduler,
    taskId,
    runNow,
    stop: () => {
      if (stopped) {
        return;
      }

      stopped = true;
      scheduler.stopAll();

      try {
        db.close();
        console.info(`[decay.scheduler][${options.mode}] stopped`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[decay.scheduler][${options.mode}] close db failed: ${message}`);
      }
    },
  };
}

function processMemoryRow(
  db: Database,
  row: BatchMemoryRow,
  decayConfig: ReturnType<typeof resolveDecayConfig>,
  now: number,
): Promise<number> {
  const metaRecord = toRecordValue(row.meta);
  const scoreFromRow = toFiniteNumber(row.score, DEFAULT_DECAY_ALGORITHM_CONFIG.maxScore / 2);

  const memoryForComputation = {
    key: row.key,
    summary: row.summary,
    text: row.text,
    meta: {
      score: toFiniteNumber(metaRecord.score, scoreFromRow),
      access_count: Math.max(0, Math.floor(toFiniteNumber(metaRecord.access_count, 0))),
      in_degree: Math.max(0, Math.floor(toFiniteNumber(metaRecord.in_degree, 0))),
      out_degree: Math.max(0, Math.floor(toFiniteNumber(metaRecord.out_degree, 0))),
      // Boundary fallback: missing last_accessed_at uses current tick to avoid invalid decay input.
      last_accessed_at: toFiniteNumber(metaRecord.last_accessed_at, now),
    },
  };

  const computed = computeDecayScore(memoryForComputation, decayConfig, now);

  return updateMemoryMetaWithOptimisticLock(
    db,
    row.key,
    getMemoryVersion(metaRecord),
    {
      score: computed.score,
      status: computed.status,
      last_decay_at: now,
    },
    computed.score,
  );
}

function toRecordValue(value: unknown): RecordValue {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as RecordValue;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as RecordValue;
      }
    } catch {
      // Debug entry: invalid persisted meta JSON falls back to empty record.
      return {};
    }
  }

  return {};
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return fallback;
}
