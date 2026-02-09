/**
 * SQLite transaction helper utilities.
 *
 * This helper guarantees rollback on failure for multi-step writes.
 * Debug entry point: inspect thrown error path in `runInTransaction`.
 */

import type { Database } from "bun:sqlite";

const transactionDepth = new WeakMap<Database, number>();

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
