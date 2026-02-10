/**
 * KV module implementation backed by SQLite.
 *
 * This class preserves the old method signatures while switching storage engine.
 * Debug entry point: start from `getMemoryRow()` when read/write mismatch appears.
 */

import type { Database } from "bun:sqlite";
import {
  MemoryNoMetaSchema,
  MemoryStatusEnums,
  type Memory,
  type MemoryMeta,
  type MemoryNoMeta,
} from "../../type";
import {
  getDatabase,
  initDatabase,
  linksToRelationRows,
  memoryRowToMemory,
  memoryToWritableColumns,
  mergeMemoryPatch,
  runInTransaction,
  withRenamedMetaId,
  type MemoryRow,
} from "../db";

export class KVMemory {
  private _database: Database;

  constructor() {
    this._database = initDatabase(getDatabase());

    // Mixed access with other SQLite clients (e.g. legacy Keyv session storage)
    // may hit transient write locks; WAL + busy timeout improves interoperability.
    this._database.run("PRAGMA journal_mode = WAL;");
    this._database.run("PRAGMA busy_timeout = 5000;");
  }

  async add(key: string, arg: MemoryNoMeta) {
    const payload = MemoryNoMetaSchema.parse(arg);
    const now = Date.now();

    // Meta is initialized exactly like old Keyv behavior to keep compatibility.
    const meta: MemoryMeta = {
      id: key,
      created_at: now,
      last_accessed_at: now,
      last_linked_at: now,
      in_degree: 0,
      out_degree: 0,
      access_count: 0,
      traverse_count: 0,
      status: MemoryStatusEnums.parse("active"),
    };

    const memory: Memory = {
      ...payload,
      meta,
    };

    const writable = memoryToWritableColumns(memory);

    runInTransaction(this._database, () => {
      this._database
        .query(
          `INSERT OR REPLACE INTO memories
           (key, summary, text, meta, links, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          key,
          writable.summary,
          writable.text,
          writable.meta,
          writable.links,
          writable.created_at,
        );

      this.replaceLinkRelations(key, memory.links, memory.meta.created_at);
    });
  }

  async get(key: string): Promise<Memory | undefined> {
    const row = this.getMemoryRow(key);
    if (!row) {
      return undefined;
    }

    return memoryRowToMemory(row);
  }

  async setMeta(key: string, meta: MemoryMeta) {
    const current = this.getMemoryRow(key);
    if (!current) {
      throw new Error(`KVMemory: setMeta: key ${key} not found`);
    }

    const memory = memoryRowToMemory(current);
    const updated: Memory = {
      ...memory,
      meta,
    };
    const writable = memoryToWritableColumns(updated);

    runInTransaction(this._database, () => {
      this._database
        .query(
          `UPDATE memories SET meta = ?, created_at = ? WHERE key = ?`,
        )
        .run(writable.meta, writable.created_at, key);
    });
  }

  async update(key: string, arg: Partial<Memory>) {
    const current = this.getMemoryRow(key);
    if (!current) {
      throw new Error(`KVMemory: update: key ${key} not found`);
    }

    const currentMemory = memoryRowToMemory(current);
    const updatedMemory = mergeMemoryPatch(currentMemory, arg);
    const writable = memoryToWritableColumns(updatedMemory);

    runInTransaction(this._database, () => {
      this._database
        .query(
          `UPDATE memories
           SET summary = ?, text = ?, meta = ?, links = ?, created_at = ?
           WHERE key = ?`,
        )
        .run(
          writable.summary,
          writable.text,
          writable.meta,
          writable.links,
          writable.created_at,
          key,
        );

      this.replaceLinkRelations(
        key,
        updatedMemory.links,
        updatedMemory.meta.created_at,
      );
    });
  }

  async updateKey(oldKey: string, newKey: string) {
    const current = this.getMemoryRow(oldKey);
    if (!current) {
      throw new Error(`KVMemory: updateKey: key ${oldKey} not found`);
    }

    const memory = memoryRowToMemory(current);
    const updated: Memory = {
      ...memory,
      meta: withRenamedMetaId(memory.meta, newKey),
    };
    const writable = memoryToWritableColumns(updated);

    runInTransaction(this._database, () => {
      // Insert new key first so FK constraints stay valid for subsequent link updates.
      this._database
        .query(
          `INSERT INTO memories
           (key, summary, text, meta, links, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newKey,
          writable.summary,
          writable.text,
          writable.meta,
          writable.links,
          writable.created_at,
        );

      // Keep relation table synchronized for both outgoing and incoming edges.
      this._database
        .query(
          `UPDATE memory_links
           SET from_key = ?
           WHERE from_key = ?`,
        )
        .run(newKey, oldKey);

      this._database
        .query(
          `UPDATE memory_links
           SET to_key = ?
           WHERE to_key = ?`,
        )
        .run(newKey, oldKey);

      this._database
        .query(`DELETE FROM memories WHERE key = ?`)
        .run(oldKey);

      // Rebuild outgoing links from JSON to guarantee row-level consistency.
      this.replaceLinkRelations(newKey, updated.links, updated.meta.created_at);
    });
  }

  /**
   * Replace link rows for one memory by current JSON links.
   *
   * Debug hint: if relation table misses expected rows, inspect `existsMemory()` filter.
   */
  private replaceLinkRelations(
    fromKey: string,
    links: Memory["links"],
    createdAt: number,
  ): void {
    this._database
      .query(`DELETE FROM memory_links WHERE from_key = ?`)
      .run(fromKey);

    const rows = linksToRelationRows(fromKey, links, createdAt);
    if (rows.length === 0) {
      return;
    }

    const insertLinkStatement = this._database.query(
      `INSERT INTO memory_links (from_key, to_key, link_type, weight, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );

    for (const row of rows) {
      // Skip dangling target keys to keep backward compatibility with JSON links.
      if (!this.existsMemory(row.to_key)) {
        continue;
      }

      insertLinkStatement.run(
        row.from_key,
        row.to_key,
        row.link_type,
        row.weight,
        row.created_at,
      );
    }
  }

  /**
   * Check whether a memory key exists.
   */
  private existsMemory(key: string): boolean {
    const row = this._database
      .query(`SELECT key FROM memories WHERE key = ? LIMIT 1`)
      .get(key) as { key: string } | null;

    return row !== null;
  }

  /**
   * Read one memory row from DB.
   */
  private getMemoryRow(key: string): MemoryRow | undefined {
    const row = this._database
      .query(
        `SELECT key, summary, text, meta, links, created_at
         FROM memories
         WHERE key = ?
         LIMIT 1`,
      )
      .get(key) as MemoryRow | null;

    return row ?? undefined;
  }
}
