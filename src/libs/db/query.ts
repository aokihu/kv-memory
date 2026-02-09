/**
 * Query mapping helpers for memory SQLite storage.
 *
 * This module centralizes row<->domain conversion so KV layer keeps business flow clear.
 * Debug entry point: inspect `memoryRowToMemory()` when read result looks malformed.
 */

import type { Memory, MemoryMeta } from "../../type";
import { MemoryLink, MemoryMetaSchema, MemorySchema } from "../../type";

/**
 * Raw row shape returned from `memories` table reads.
 */
export type MemoryRow = {
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
};

/**
 * Raw row shape for `memory_links` insert operations.
 */
export type MemoryLinkRow = {
  namespace: string;
  from_key: string;
  to_key: string;
  link_type: string;
  weight: number;
  created_at: number;
};

/**
 * Convert DB row into validated `Memory` object.
 *
 * Trigger condition: called after selecting one memory row.
 * Debug hint: malformed JSON or schema drift will throw during parse.
 */
export function memoryRowToMemory(row: MemoryRow): Memory {
  const meta = MemoryMetaSchema.parse(JSON.parse(row.meta));
  const keywords = parseStringArray(row.keywords);
  const links = parseMemoryLinks(row.links);

  return MemorySchema.parse({
    meta,
    domain: row.domain,
    summary: row.summary,
    text: row.text,
    type: row.type,
    keywords,
    links,
  });
}

/**
 * Build values used for memories table write.
 *
 * Trigger condition: add/update write path.
 */
export function memoryToWritableColumns(memory: Memory): {
  domain: string;
  summary: string;
  text: string;
  type: string;
  keywords: string;
  meta: string;
  links: string;
  created_at: number;
} {
  const validated = MemorySchema.parse(memory);

  return {
    domain: validated.domain,
    summary: validated.summary,
    text: validated.text,
    type: validated.type,
    keywords: JSON.stringify(validated.keywords),
    meta: JSON.stringify(validated.meta),
    links: JSON.stringify(validated.links),
    created_at: validated.meta.created_at,
  };
}

/**
 * Convert memory links to relation table rows.
 *
 * Trigger condition: synchronize links JSON to `memory_links` table.
 * Debug hint: links without `key` are intentionally skipped.
 */
export function linksToRelationRows(
  namespace: string,
  fromKey: string,
  links: Memory["links"],
  createdAt: number,
): MemoryLinkRow[] {
  const rows: MemoryLinkRow[] = [];

  for (const rawLink of links) {
    const link = MemoryLink.parse(rawLink);
    if (!link.key) {
      continue;
    }

    rows.push({
      namespace,
      from_key: fromKey,
      to_key: link.key,
      link_type: link.type,
      weight: link.weight,
      created_at: createdAt,
    });
  }

  return rows;
}

/**
 * Parse JSON string array safely with validation.
 */
function parseStringArray(raw: string): string[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("keywords column is not an array");
  }

  return parsed.map((value) => {
    if (typeof value !== "string") {
      throw new Error("keywords array contains non-string value");
    }
    return value;
  });
}

/**
 * Parse links JSON and validate each link item.
 */
function parseMemoryLinks(raw: string): Memory["links"] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("links column is not an array");
  }

  return parsed.map((item) => MemoryLink.parse(item));
}

/**
 * Merge partial memory patch and return validated full memory.
 *
 * Trigger condition: update flow that receives `Partial<Memory>`.
 */
export function mergeMemoryPatch(current: Memory, patch: Partial<Memory>): Memory {
  return MemorySchema.parse({
    ...current,
    ...patch,
  });
}

/**
 * Build updated meta with new key id.
 */
export function withRenamedMetaId(meta: MemoryMeta, newKey: string): MemoryMeta {
  return MemoryMetaSchema.parse({
    ...meta,
    id: newKey,
  });
}
