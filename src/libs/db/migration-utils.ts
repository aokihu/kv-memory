/**
 * Keyv-to-SQLite migration utility functions.
 *
 * This module handles source row parsing, conversion, and validation.
 * Debug entry point: start from `parseKeyvRowToMemoryRecord()` for conversion failures.
 */

import type { Database } from "bun:sqlite";
import { MemoryLink, MemoryWithLinksSchema, type Memory, type MemoryLinkValue } from "../../type";
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
  links: MemoryLinkValue[];
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
  const memoryWithLinks = MemoryWithLinksSchema.parse(unwrapped);
  const parsedKey = parseNamespacedKey(row.key);

  return {
    namespace: parsedKey.namespace,
    key: parsedKey.key,
    memory: {
      summary: memoryWithLinks.summary,
      text: memoryWithLinks.text,
      meta: memoryWithLinks.meta,
    },
    links: memoryWithLinks.links,
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
      record.key,
      record.links,
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
        `SELECT key, summary, text, meta, created_at
          FROM memories
          WHERE key = ?
          LIMIT 1`,
      )
      .get(record.key) as
      | {
          key: string;
          summary: string;
          text: string;
          meta: string;
          created_at: number;
        }
      | null;

    if (!row) {
      mismatches.push(`${record.namespace}:${record.key} missing`);
      continue;
    }

    const targetMemory = memoryRowToMemory(row);
    const targetLinks = readRelationLinks(targetDatabase, record.key);
    const sourceRelationLinks = record.links.filter((link) => Boolean(link.key));
    if (!areMemoriesEqual(record.memory, targetMemory, sourceRelationLinks, targetLinks)) {
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
 * Read relation links for one source key.
 */
function readRelationLinks(targetDatabase: Database, fromKey: string): MemoryLinkValue[] {
  const rows = targetDatabase
    .query(
      `SELECT to_key, link_type, term, weight
       FROM memory_links
       WHERE from_key = ?
       ORDER BY id`,
    )
    .all(fromKey) as Array<{ to_key: string; link_type: string; term: string; weight: number }>;

  return rows.map((row) => MemoryLink.parse({
    type: row.link_type,
    key: row.to_key,
    term: row.term,
    weight: row.weight,
  }));
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
function areMemoriesEqual(a: Memory, b: Memory, aLinks: MemoryLinkValue[], bLinks: MemoryLinkValue[]): boolean {
  if (a.summary !== b.summary || a.text !== b.text) {
    return false;
  }

  if (
    a.meta.id !== b.meta.id
    || a.meta.created_at !== b.meta.created_at
    || a.meta.last_accessed_at !== b.meta.last_accessed_at
    || a.meta.last_linked_at !== b.meta.last_linked_at
    || a.meta.in_degree !== b.meta.in_degree
    || a.meta.out_degree !== b.meta.out_degree
    || a.meta.access_count !== b.meta.access_count
    || a.meta.traverse_count !== b.meta.traverse_count
    || a.meta.status !== b.meta.status
  ) {
    return false;
  }

  const normalize = (links: MemoryLinkValue[]) => {
    return links
      .filter((link) => Boolean(link.key))
      .map((link) => ({
        type: link.type,
        key: link.key as string,
        term: link.term,
        weight: link.weight,
      }))
      .sort((left, right) => {
        const leftKey = `${left.key}:${left.type}:${left.term}`;
        const rightKey = `${right.key}:${right.type}:${right.term}`;
        return leftKey.localeCompare(rightKey);
      });
  };

  const leftLinks = normalize(aLinks);
  const rightLinks = normalize(bLinks);

  if (leftLinks.length !== rightLinks.length) {
    return false;
  }

  for (let index = 0; index < leftLinks.length; index += 1) {
    const left = leftLinks[index]!;
    const right = rightLinks[index]!;
    if (
      left.type !== right.type
      || left.key !== right.key
      || left.term !== right.term
      || Math.abs(left.weight - right.weight) > 1e-9
    ) {
      return false;
    }
  }

  return true;
}
