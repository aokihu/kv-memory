/**
 * SQLite transaction helper utilities.
 *
 * This helper guarantees rollback on failure for multi-step writes.
 * Debug entry point: inspect thrown error path in `runInTransaction`.
 */

import type { Database } from "bun:sqlite";

const transactionDepth = new WeakMap<Database, number>();

interface NormalizedTransactionRetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  logger?: Pick<Console, "warn">;
  shouldRetry: (error: unknown) => boolean;
}

const DEFAULT_TRANSACTION_RETRY_OPTIONS: NormalizedTransactionRetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 20,
  maxDelayMs: 500,
  backoffMultiplier: 2,
  logger: undefined,
  shouldRetry: isSqliteBusyError,
};

/**
 * Retry configuration for transactional writes.
 *
 * Debug hint: if retries do not trigger, inspect `shouldRetry` and SQLite error message.
 */
export interface TransactionRetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  logger?: Pick<Console, "warn">;
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Retry callback payload for observability.
 */
export interface TransactionRetryContext {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
}

/**
 * Execute callback inside transaction.
 *
 * Trigger conditions:
 * - depth 0: `BEGIN IMMEDIATE ... COMMIT`
 * - nested depth: `SAVEPOINT ... RELEASE`
 *
 * Debug hint: if nested rollback behaves unexpectedly, inspect generated savepoint names.
 */
export function runInTransaction<T>(database: Database, handler: () => T): T {
  const currentDepth = transactionDepth.get(database) ?? 0;

  if (currentDepth === 0) {
    database.exec("BEGIN IMMEDIATE");
  } else {
    database.exec(`SAVEPOINT kv_tx_${currentDepth}`);
  }

  transactionDepth.set(database, currentDepth + 1);

  try {
    const result = handler();

    if (currentDepth === 0) {
      database.exec("COMMIT");
    } else {
      database.exec(`RELEASE SAVEPOINT kv_tx_${currentDepth}`);
    }

    return result;
  } catch (error) {
    if (currentDepth === 0) {
      database.exec("ROLLBACK");
    } else {
      database.exec(`ROLLBACK TO SAVEPOINT kv_tx_${currentDepth}`);
      database.exec(`RELEASE SAVEPOINT kv_tx_${currentDepth}`);
    }

    throw error;
  } finally {
    if (currentDepth === 0) {
      transactionDepth.delete(database);
    } else {
      transactionDepth.set(database, currentDepth);
    }
  }
}

/**
 * Execute callback inside transaction and retry on lock conflicts.
 *
 * Trigger conditions:
 * - `SQLITE_BUSY`/`database is locked`: retry with exponential backoff.
 * - non-retryable error or attempts exhausted: fail fast.
 *
 * Debug hint: when lock conflicts keep failing, inspect retry options and concurrent writers.
 */
export async function runInTransactionWithRetry<T>(
  database: Database,
  handler: () => T,
  options: TransactionRetryOptions = {},
): Promise<T> {
  const retryOptions = normalizeRetryOptions(options);

  for (let attempt = 1; attempt <= retryOptions.maxAttempts; attempt += 1) {
    try {
      return runInTransaction(database, handler);
    } catch (error) {
      const canRetry =
        attempt < retryOptions.maxAttempts && retryOptions.shouldRetry(error);

      if (!canRetry) {
        throw error;
      }

      const delayMs = calculateBackoffDelay(attempt, retryOptions);
      retryOptions.logger?.warn(
        `transaction: retry ${attempt}/${retryOptions.maxAttempts} after SQLITE_BUSY in ${delayMs}ms`,
      );
      await wait(delayMs);
    }
  }

  throw new Error("transaction: retry loop exited unexpectedly");
}

/**
 * Execute multiple write actions in one explicit transaction.
 *
 * Debug hint: if one action fails but prior writes persist, inspect caller path to ensure this helper is used.
 */
export function runBatchInTransaction<TItem, TResult>(
  database: Database,
  items: readonly TItem[],
  handler: (item: TItem, index: number) => TResult,
): TResult[] {
  return runInTransaction(database, () => {
    const results: TResult[] = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index] as TItem;
      results.push(handler(item, index));
    }

    return results;
  });
}

/**
 * Execute multiple write actions in one transaction with SQLITE_BUSY retries.
 *
 * Debug hint: if batch retries are frequent, inspect write contention and batch size.
 */
export async function runBatchInTransactionWithRetry<TItem, TResult>(
  database: Database,
  items: readonly TItem[],
  handler: (item: TItem, index: number) => TResult,
  options: TransactionRetryOptions = {},
): Promise<TResult[]> {
  return runInTransactionWithRetry(
    database,
    () => runBatchInTransaction(database, items, handler),
    options,
  );
}

/**
 * Detect whether an error is caused by SQLite lock contention.
 */
export function isSqliteBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toUpperCase();
  return message.includes("SQLITE_BUSY") || message.includes("DATABASE IS LOCKED");
}

function normalizeRetryOptions(options: TransactionRetryOptions): NormalizedTransactionRetryOptions {
  return {
    maxAttempts: toPositiveInteger(options.maxAttempts, DEFAULT_TRANSACTION_RETRY_OPTIONS.maxAttempts),
    initialDelayMs: toPositiveInteger(
      options.initialDelayMs,
      DEFAULT_TRANSACTION_RETRY_OPTIONS.initialDelayMs,
    ),
    maxDelayMs: toPositiveInteger(options.maxDelayMs, DEFAULT_TRANSACTION_RETRY_OPTIONS.maxDelayMs),
    backoffMultiplier:
      typeof options.backoffMultiplier === "number" && options.backoffMultiplier > 1
        ? options.backoffMultiplier
        : DEFAULT_TRANSACTION_RETRY_OPTIONS.backoffMultiplier,
    logger: options.logger,
    shouldRetry: options.shouldRetry ?? DEFAULT_TRANSACTION_RETRY_OPTIONS.shouldRetry,
  };
}

function toPositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const parsed = Math.floor(value);
  return parsed >= 1 ? parsed : fallback;
}

function calculateBackoffDelay(
  attempt: number,
  options: NormalizedTransactionRetryOptions,
): number {
  const exponent = Math.max(0, attempt - 1);
  const delay = options.initialDelayMs * options.backoffMultiplier ** exponent;
  return Math.min(options.maxDelayMs, Math.floor(delay));
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
