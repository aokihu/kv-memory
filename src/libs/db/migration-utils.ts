/**
 * Keyv-to-SQLite migration utility functions.
 *
 * This module handles source row parsing, conversion, and validation.
 * Debug entry point: start from `parseKeyvRowToMemoryRecord()` for conversion failures.
 */

import type { Database } from "bun:sqlite";
import { MemorySchema, type Memory } from "../../type";
import { linksToRelationRows, memoryToWritableColumns, memoryRowToMemory, type MemoryLinkRow } from "./query";

/**
 * Legacy Keyv row shape.
 */
export type KeyvRow = {
  key: string;
  value: string;
};

/**
 * Parsed memory record used during migration.
 */
export type MigratedMemoryRecord = {
  namespace: string;
  key: string;
  memory: Memory;
};

/**
 * Conversion warning for skipped rows.
 */
export type MigrationWarning = {
  key: string;
  reason: string;
};

/**
 * Parse Keyv key into namespace and memory key.
 *
 * Trigger condition: Keyv stores namespaced key as `namespace:key`.
 */
export function parseNamespacedKey(rawKey: string): { namespace: string; key: string } {
  const delimiterIndex = rawKey.indexOf(":");
  if (delimiterIndex === -1) {
    return {
      namespace: "mem",
      key: rawKey,
    };
  }

  return {
    namespace: rawKey.slice(0, delimiterIndex),
    key: rawKey.slice(delimiterIndex + 1),
  };
}

/**
 * Convert one Keyv row into validated memory record.
 *
 * Debug hint: this function supports both legacy wrapped payload
 * (`{"value": ...}`) and direct memory payload.
 */
export function parseKeyvRowToMemoryRecord(row: KeyvRow): MigratedMemoryRecord {
  const parsedValue = JSON.parse(row.value) as unknown;
  const unwrapped = unwrapKeyvValue(parsedValue);
  const memory = MemorySchema.parse(unwrapped);
  const parsedKey = parseNamespacedKey(row.key);

  return {
    namespace: parsedKey.namespace,
    key: parsedKey.key,
    memory,
  };
}

/**
 * Read all rows from legacy `keyv` table.
 */
export function readKeyvRows(sourceDatabase: Database): KeyvRow[] {
  const table = sourceDatabase
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'keyv'")
    .get() as { name: string } | null;

  if (!table) {
    throw new Error("source database does not contain table 'keyv'");
  }

  return sourceDatabase.query("SELECT key, value FROM keyv ORDER BY key").all() as KeyvRow[];
}

/**
 * Convert all legacy rows and collect warnings instead of failing the whole run.
 */
export function convertKeyvRows(rows: KeyvRow[]): { records: MigratedMemoryRecord[]; warnings: MigrationWarning[] } {
  const records: MigratedMemoryRecord[] = [];
  const warnings: MigrationWarning[] = [];

  for (const row of rows) {
    try {
      records.push(parseKeyvRowToMemoryRecord(row));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown parse error";
      warnings.push({ key: row.key, reason });
    }
  }

  return { records, warnings };
}

/**
 * Build writable memory columns and relation rows for insert/upsert.
 */
export function buildWritableMigrationData(record: MigratedMemoryRecord): {
  namespace: string;
  key: string;
  memoryColumns: ReturnType<typeof memoryToWritableColumns>;
  linkRows: MemoryLinkRow[];
} {
  return {
    namespace: record.namespace,
    key: record.key,
    memoryColumns: memoryToWritableColumns(record.memory),
    linkRows: linksToRelationRows(
      record.namespace,
      record.key,
      record.memory.links,
      record.memory.meta.created_at,
    ),
  };
}

/**
 * Validate migration result by comparing source and target memory content.
 *
 * Debug hint: mismatch list identifies keys that differ after conversion.
 */
export function validateMigratedRecords(
  targetDatabase: Database,
  records: MigratedMemoryRecord[],
): {
  total: number;
  matched: number;
  mismatches: string[];
} {
  const mismatches: string[] = [];

  for (const record of records) {
    const row = targetDatabase
      .query(
        `SELECT key, namespace, domain, summary, text, type, keywords, meta, links, created_at
         FROM memories
         WHERE namespace = ? AND key = ?
         LIMIT 1`,
      )
      .get(record.namespace, record.key) as
      | {
          key: string;
          namespace: string;
          domain: string;
          summary: string;
          text: string;
          type: string;
          keywords: string;
          meta: string;
          links: string;
          created_at: number;
        }
      | null;

    if (!row) {
      mismatches.push(`${record.namespace}:${record.key} missing`);
      continue;
    }

    const targetMemory = memoryRowToMemory(row);
    if (!areMemoriesEqual(record.memory, targetMemory)) {
      mismatches.push(`${record.namespace}:${record.key} content mismatch`);
    }
  }

  return {
    total: records.length,
    matched: records.length - mismatches.length,
    mismatches,
  };
}

/**
 * Unwrap Keyv stored payload to raw object.
 */
function unwrapKeyvValue(parsedValue: unknown): unknown {
  if (
    parsedValue !== null
    && typeof parsedValue === "object"
    && "value" in parsedValue
    && Object.keys(parsedValue as Record<string, unknown>).length >= 1
  ) {
    return (parsedValue as { value: unknown }).value;
  }

  return parsedValue;
}

/**
 * Compare memory payloads deterministically.
 */
function areMemoriesEqual(a: Memory, b: Memory): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
