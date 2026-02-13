/**
 * Memory decay batch processor.
 * Handles large-memory iteration with checkpoint-based resume support.
 */

import type { Database } from "bun:sqlite";

import type { DecayConfig } from "./types";

/**
 * Minimal memory row shape read from database batches.
 */
export type BatchMemoryRow = {
  key: string;
  summary: string;
  text: string;
  meta: unknown;
  score?: number;
};

/**
 * Checkpoint payload used to continue processing from last completed batch.
 */
export type BatchProcessingCheckpoint = {
  nextOffset: number;
  processedMemories: number;
  processedBatches: number;
};

/**
 * Runtime statistics for one batch processing run.
 */
export type BatchProcessingStats = {
  totalMemories: number;
  processedMemories: number;
  processedBatches: number;
  failedBatches: number;
  retryCount: number;
  interrupted: boolean;
  lastError: string | null;
  checkpoint: BatchProcessingCheckpoint;
};

/**
 * Runtime controls for delay, retry and interruption behavior.
 */
export type BatchProcessingControlConfig = {
  batchDelayMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  transactionTimeoutMs?: number;
  checkpoint?: BatchProcessingCheckpoint;
  signal?: AbortSignal;
  shouldInterrupt?: () => boolean;
  onProgress?: (stats: BatchProcessingStats) => void;
};

/**
 * Per-memory processing callback.
 */
export type MemoryProcessFn = (memory: BatchMemoryRow) => void | Promise<void>;

/**
 * Conflict raised when expected version does not match current stored version.
 * Debug entry: inspect `key`, `expectedVersion`, `actualVersion` from this error.
 */
export class OptimisticLockConflictError extends Error {
  readonly key: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(key: string, expectedVersion: number, actualVersion: number) {
    super(
      `Optimistic lock conflict for memory ${key}: expected version ${expectedVersion}, actual version ${actualVersion}`,
    );
    this.name = "OptimisticLockConflictError";
    this.key = key;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/**
 * Retry options for optimistic-lock updates.
 */
export type OptimisticLockRetryConfig = {
  maxConflictRetries?: number;
  conflictRetryDelayMs?: number;
};

type MemoryMetaRecord = Record<string, unknown>;

type MemoryMetaRow = {
  meta: string | null;
};

type OptimisticUpdateResult = {
  changes?: number;
};

function parseMetaRecord(meta: unknown): MemoryMetaRecord {
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return meta as MemoryMetaRecord;
  }

  if (typeof meta === "string") {
    try {
      const parsed = JSON.parse(meta) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as MemoryMetaRecord;
      }
    } catch {
      // If persisted meta is broken JSON, fallback keeps update flow recoverable.
      return {};
    }
  }

  return {};
}

function normalizeVersion(version: unknown): number {
  if (typeof version !== "number" || !Number.isFinite(version) || version < 0) {
    return 0;
  }

  return Math.floor(version);
}

/**
 * Read a usable version from unknown memory meta value.
 * Backward compatibility: missing/invalid version is treated as 0.
 */
export function getMemoryVersion(meta: unknown): number {
  const parsedMeta = parseMetaRecord(meta);
  return normalizeVersion(parsedMeta.version);
}

/**
 * Update one memory meta/score with optimistic-lock checking.
 *
 * Conflict path:
 * - if stored version != expectedVersion -> conflict error
 * - if concurrent update races between read/update -> conflict error
 *
 * Retry path:
 * - on conflict, refresh expected version from DB and retry
 */
export async function updateMemoryMetaWithOptimisticLock(
  db: Database,
  key: string,
  expectedVersion: number,
  metaPatch: MemoryMetaRecord,
  score?: number,
  retryConfig: OptimisticLockRetryConfig = {},
): Promise<number> {
  const maxConflictRetries = normalizeNonNegativeInteger(retryConfig.maxConflictRetries ?? 2, 2);
  const conflictRetryDelayMs = normalizeNonNegativeInteger(retryConfig.conflictRetryDelayMs ?? 0, 0);
  let workingExpectedVersion = normalizeVersion(expectedVersion);

  const selectMetaStatement = db.query("SELECT meta FROM memories WHERE key = ? LIMIT 1");
  const updateStatement = db.query(
    "UPDATE memories SET meta = ?, score = COALESCE(?, score), created_at = ? WHERE key = ? AND COALESCE(json_extract(meta, '$.version'), 0) = ?",
  );

  for (let attempt = 0; attempt <= maxConflictRetries; attempt += 1) {
    const currentRow = selectMetaStatement.get(key) as MemoryMetaRow | null;
    if (!currentRow) {
      throw new Error(`Memory not found: ${key}`);
    }

    const currentMeta = parseMetaRecord(currentRow.meta);
    const actualVersion = normalizeVersion(currentMeta.version);

    if (actualVersion !== workingExpectedVersion) {
      const conflict = new OptimisticLockConflictError(key, workingExpectedVersion, actualVersion);
      if (attempt >= maxConflictRetries) {
        throw conflict;
      }

      workingExpectedVersion = actualVersion;
      await sleep(conflictRetryDelayMs);
      continue;
    }

    const nextVersion = actualVersion + 1;
    const nextMeta: MemoryMetaRecord = {
      ...currentMeta,
      ...metaPatch,
      version: nextVersion,
    };
    const now = Date.now();
    const updateResult = updateStatement.run(JSON.stringify(nextMeta), score ?? null, now, key, actualVersion) as OptimisticUpdateResult;

    if ((updateResult.changes ?? 0) > 0) {
      return nextVersion;
    }

    const latestRow = selectMetaStatement.get(key) as MemoryMetaRow | null;
    const latestMeta = parseMetaRecord(latestRow?.meta ?? null);
    const latestVersion = normalizeVersion(latestMeta.version);
    const conflict = new OptimisticLockConflictError(key, actualVersion, latestVersion);
    if (attempt >= maxConflictRetries) {
      throw conflict;
    }

    workingExpectedVersion = latestVersion;
    await sleep(conflictRetryDelayMs);
  }

  throw new OptimisticLockConflictError(key, workingExpectedVersion, workingExpectedVersion);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function normalizeNonNegativeInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

function shouldStopProcessing(config: BatchProcessingControlConfig): boolean {
  if (config.signal?.aborted) {
    return true;
  }

  return config.shouldInterrupt?.() === true;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function createTimeoutError(timeoutMs: number): Error {
  return new Error(`Batch transaction timed out after ${timeoutMs}ms`);
}

const INTERRUPTED_ERROR_MESSAGE = "Batch processing interrupted";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  return await new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(createTimeoutError(timeoutMs));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function processBatchInTransaction(
  db: Database,
  batch: BatchMemoryRow[],
  processFn: MemoryProcessFn,
  controlConfig: BatchProcessingControlConfig,
  transactionTimeoutMs: number,
): Promise<number> {
  db.exec("BEGIN IMMEDIATE");

  let processedCount = 0;
  const transactionDeadline = transactionTimeoutMs > 0 ? Date.now() + transactionTimeoutMs : Number.POSITIVE_INFINITY;

  try {
    for (const memory of batch) {
      if (shouldStopProcessing(controlConfig)) {
        throw new Error(INTERRUPTED_ERROR_MESSAGE);
      }

      const remainingTimeoutMs = transactionDeadline - Date.now();

      if (remainingTimeoutMs <= 0) {
        throw createTimeoutError(transactionTimeoutMs);
      }

      await withTimeout(Promise.resolve(processFn(memory)), remainingTimeoutMs);
      processedCount += 1;
    }

    db.exec("COMMIT");
    return processedCount;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        `[decay.processor] rollback failed: ${formatError(rollbackError)} (original=${formatError(error)})`,
      );
    }
    throw error;
  }
}

/**
 * Process memories in stable batches.
 *
 * Debug hint: if processing stalls, inspect returned checkpoint and retry stats.
 */
export async function processMemoriesInBatches(
  db: Database,
  config: DecayConfig & BatchProcessingControlConfig,
  batchSize: number = 100,
  processFn: MemoryProcessFn,
): Promise<BatchProcessingStats> {
  const effectiveBatchSize = normalizePositiveInteger(batchSize, normalizePositiveInteger(config.batchSize, 100));
  const batchDelayMs = normalizePositiveInteger(config.batchDelayMs ?? 0, 0);
  const retryDelayMs = normalizePositiveInteger(config.retryDelayMs ?? 0, 0);
  const maxRetries = normalizeNonNegativeInteger(config.maxRetries ?? 2, 2);
  const transactionTimeoutMs = normalizeNonNegativeInteger(config.transactionTimeoutMs ?? 0, 0);
  const initialOffset = normalizePositiveInteger(config.checkpoint?.nextOffset ?? 0, 0);
  const initialProcessedMemories = normalizePositiveInteger(config.checkpoint?.processedMemories ?? 0, 0);
  const initialProcessedBatches = normalizePositiveInteger(config.checkpoint?.processedBatches ?? 0, 0);

  const countRow = db.query("SELECT COUNT(*) AS count FROM memories").get() as { count?: number } | null;
  const totalMemories = countRow?.count ?? 0;
  const selectStatement = db.query(
    "SELECT key, summary, text, meta, score FROM memories ORDER BY key ASC LIMIT ? OFFSET ?",
  );

  const stats: BatchProcessingStats = {
    totalMemories,
    processedMemories: initialProcessedMemories,
    processedBatches: initialProcessedBatches,
    failedBatches: 0,
    retryCount: 0,
    interrupted: false,
    lastError: null,
    checkpoint: {
      nextOffset: initialOffset,
      processedMemories: initialProcessedMemories,
      processedBatches: initialProcessedBatches,
    },
  };

  let offset = initialOffset;

  while (offset < totalMemories) {
    // Interruption is checked before each batch so external callers can stop safely.
    if (shouldStopProcessing(config)) {
      stats.interrupted = true;
      break;
    }

    const batch = selectStatement.all(effectiveBatchSize, offset) as BatchMemoryRow[];

    if (batch.length === 0) {
      break;
    }

    let batchSucceeded = false;
    let processedInCurrentBatch = 0;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        processedInCurrentBatch = await processBatchInTransaction(
          db,
          batch,
          processFn,
          config,
          transactionTimeoutMs,
        );
        batchSucceeded = true;
        break;
      } catch (error) {
        const errorMessage = formatError(error);
        stats.lastError = errorMessage;

        if (errorMessage === INTERRUPTED_ERROR_MESSAGE) {
          stats.interrupted = true;
          break;
        }

        if (attempt >= maxRetries) {
          stats.failedBatches += 1;
          console.error(`[decay.processor] batch transaction failed permanently at offset=${offset}: ${errorMessage}`);
          break;
        }

        stats.retryCount += 1;
        attempt += 1;
        console.warn(
          `[decay.processor] batch transaction retry offset=${offset} attempt=${attempt}/${maxRetries} reason=${errorMessage}`,
        );
        await sleep(retryDelayMs);
      }
    }

    if (batchSucceeded) {
      stats.processedMemories += processedInCurrentBatch;
      stats.processedBatches += 1;
    }

    if (!stats.interrupted) {
      // Advance by full batch size so one bad batch does not block the full decay run.
      offset += batch.length;
    }

    // Checkpoint reflects only committed memories when transaction mode is enabled.
    stats.checkpoint = {
      nextOffset: offset,
      processedMemories: stats.processedMemories,
      processedBatches: stats.processedBatches,
    };

    config.onProgress?.(stats);

    // Delay between batches prevents tight loops from blocking other workloads.
    if (stats.interrupted) {
      break;
    }

    if (batchDelayMs > 0 && offset < totalMemories) {
      await sleep(batchDelayMs);
    }
  }

  return stats;
}
