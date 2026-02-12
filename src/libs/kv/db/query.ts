/**
 * Query mapping helpers for memory SQLite storage.
 *
 * This module centralizes row<->domain conversion so KV layer keeps business flow clear.
 * Debug entry point: inspect `memoryRowToMemory()` when read result looks malformed.
 */

import type { Memory, MemoryLinkValue, MemoryMeta } from "../../../type";
import { MemoryLink, MemoryMetaSchema, MemorySchema } from "../../../type";

/**
 * Raw row shape returned from `memories` table reads.
 */
export type MemoryRow = {
  key: string;
  summary: string;
  text: string;
  meta: string;
  created_at: number;
};

/**
 * Raw row shape for `memory_links` insert operations.
 */
export type MemoryLinkRow = {
  from_key: string;
  to_key: string;
  link_type: string;
  term: string;
  weight: number;
  created_at: number;
};

export type MemoryLinkRelationReadRow = {
  to_key: string;
  link_type: string;
  term: string;
  weight: number;
};

/**
 * Convert DB row into validated `Memory` object.
 *
 * Trigger condition: called after selecting one memory row.
 * Debug hint: malformed JSON or schema drift will throw during parse.
 */
export function memoryRowToMemory(row: MemoryRow): Memory {
  const meta = MemoryMetaSchema.parse(JSON.parse(row.meta));

  return MemorySchema.parse({
    meta,
    summary: row.summary,
    text: row.text,
  });
}

/**
 * Build values used for memories table write.
 *
 * Trigger condition: add/update write path.
 */
export function memoryToWritableColumns(memory: Memory): {
  summary: string;
  text: string;
  meta: string;
  created_at: number;
} {
  const validated = MemorySchema.parse(memory);

  return {
    summary: validated.summary,
    text: validated.text,
    meta: JSON.stringify(validated.meta),
    created_at: validated.meta.created_at,
  };
}

/**
 * Convert memory links to relation table rows.
 *
 * Trigger condition: persist link payload to `memory_links` table.
 * Debug hint: links without `key` are intentionally skipped.
 */
export function linksToRelationRows(
  fromKey: string,
  links: MemoryLinkValue[],
  createdAt: number,
): MemoryLinkRow[] {
  const rows: MemoryLinkRow[] = [];

  for (const rawLink of links) {
    const link = MemoryLink.parse(rawLink);
    if (!link.key) {
      continue;
    }

    rows.push({
      from_key: fromKey,
      to_key: link.key,
      link_type: link.type,
      term: link.term,
      weight: link.weight,
      created_at: createdAt,
    });
  }

  return rows;
}

/**
 * Convert relation table row to memory link payload.
 */
export function relationRowToMemoryLink(row: MemoryLinkRelationReadRow): MemoryLinkValue {
  return MemoryLink.parse({
    type: row.link_type,
    key: row.to_key,
    term: row.term,
    weight: row.weight,
  });
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
