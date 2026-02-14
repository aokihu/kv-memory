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
  type MemoryLinkValue,
  type Memory,
  type MemoryMeta,
  type MemoryNoMeta,
} from "../../type";
import {
  getDatabase,
  getDatabaseConfig,
  initDatabase,
  linksToRelationRows,
  memoryRowToMemory,
  memoryToWritableColumns,
  relationRowToMemoryLink,
  optimizeFtsIndex as optimizeFtsIndexInDb,
  rebuildFtsIndex as rebuildFtsIndexInDb,
  mergeMemoryPatch,
  runBatchInTransactionWithRetry,
  runInTransactionWithRetry,
  withRenamedMetaId,
  type MemoryLinkRelationReadRow,
  type MemoryRow,
} from "./db";

export class KVMemory {
  private _database: Database;
  private _searchEnabled: boolean;

  constructor() {
    this._database = initDatabase(getDatabase());
    this._searchEnabled = getDatabaseConfig().searchEnabled;

    // Mixed access with other SQLite clients (e.g. legacy Keyv session storage)
    // may hit transient write locks; WAL + busy timeout improves interoperability.
    this._database.exec("PRAGMA journal_mode = WAL;");
    this._database.exec("PRAGMA busy_timeout = 5000;");
  }

  async add(key: string, arg: MemoryNoMeta, links: MemoryLinkValue[] = []) {
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
      score: 50,
      status: MemoryStatusEnums.parse("active"),
    };

    const memory: Memory = {
      ...payload,
      meta,
    };

    const writable = memoryToWritableColumns(memory);

    const writeSteps: Array<() => void> = [
      () => {
        this._database
          .query(
            `INSERT OR REPLACE INTO memories
             (key, summary, text, meta, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            key,
            writable.summary,
            writable.text,
            writable.meta,
            writable.created_at,
          );
      },
      () => {
        this.replaceLinkRelations(key, links, memory.meta.created_at);
      },
    ];

    await runBatchInTransactionWithRetry(this._database, writeSteps, (step) => step(), {
      logger: console,
    });
  }

  async get(key: string): Promise<Memory | undefined> {
    const row = this.getMemoryRow(key);
    if (!row) {
      return undefined;
    }

    return memoryRowToMemory(row);
  }

  /**
   * Batch-read memories by keys.
   *
   * Debug entry point: if batch result misses expected keys, check input key list
   * and verify generated placeholder count in SQL IN clause.
   */
  async getMany(keys: string[]): Promise<Record<string, Memory | undefined>> {
    const uniqueKeys = [...new Set(keys.filter((item) => item.length > 0))];
    if (uniqueKeys.length === 0) {
      return {};
    }

    const placeholders = uniqueKeys.map(() => "?").join(", ");
    const rows = this._database
      .query(
        `SELECT key, summary, text, meta, created_at
         FROM memories
         WHERE key IN (${placeholders})`,
      )
      .all(...uniqueKeys) as MemoryRow[];

    const memoriesByKey: Record<string, Memory | undefined> = {};
    for (const key of uniqueKeys) {
      memoriesByKey[key] = undefined;
    }

    for (const row of rows) {
      memoriesByKey[row.key] = memoryRowToMemory(row);
    }

    return memoriesByKey;
  }

  async getLinks(key: string): Promise<MemoryLinkValue[]> {
    const rows = this._database
      .query(
        `SELECT to_key, link_type, term, weight
         FROM memory_links
         WHERE from_key = ?
         ORDER BY id`,
      )
      .all(key) as MemoryLinkRelationReadRow[];

    return rows.map((row) => relationRowToMemoryLink(row));
  }

  /**
   * Batch-read outgoing links for multiple memories.
   *
   * Debug entry point: if one source key has empty links unexpectedly,
   * verify `from_key` values in `memory_links` and input key normalization.
   */
  async getLinksMany(keys: string[]): Promise<Record<string, MemoryLinkValue[]>> {
    const uniqueKeys = [...new Set(keys.filter((item) => item.length > 0))];
    const linksByKey: Record<string, MemoryLinkValue[]> = {};

    for (const key of uniqueKeys) {
      linksByKey[key] = [];
    }

    if (uniqueKeys.length === 0) {
      return linksByKey;
    }

    const placeholders = uniqueKeys.map(() => "?").join(", ");
    const rows = this._database
      .query(
        `SELECT from_key, to_key, link_type, term, weight
         FROM memory_links
         WHERE from_key IN (${placeholders})
         ORDER BY id`,
      )
      .all(...uniqueKeys) as Array<
      MemoryLinkRelationReadRow & {
        from_key: string;
      }
    >;

    for (const row of rows) {
      const links = linksByKey[row.from_key] ?? [];
      links.push(relationRowToMemoryLink(row));
      linksByKey[row.from_key] = links;
    }

    return linksByKey;
  }

  async setMeta(key: string, meta: MemoryMeta) {
    const current = this.getMemoryRow(key);
    if (!current) {
      throw new Error(`KVMemory: setMeta: key ${key} not found`);
    }

    const memory = memoryRowToMemory(current);
    const nextMeta: MemoryMeta =
      meta.score === undefined
        ? {
            ...meta,
            score: memory.meta.score,
          }
        : meta;
    const updated: Memory = {
      ...memory,
      meta: nextMeta,
    };
    const writable = memoryToWritableColumns(updated);

    await runInTransactionWithRetry(
      this._database,
      () => {
        this._database
          .query(`UPDATE memories SET meta = ?, created_at = ? WHERE key = ?`)
          .run(writable.meta, writable.created_at, key);
      },
      {
        logger: console,
      },
    );
  }

  async update(
    key: string,
    arg: Partial<MemoryNoMeta>,
    links?: MemoryLinkValue[],
  ) {
    const current = this.getMemoryRow(key);
    if (!current) {
      throw new Error(`KVMemory: update: key ${key} not found`);
    }

    const currentMemory = memoryRowToMemory(current);
    const patchedMemory = mergeMemoryPatch(currentMemory, arg);
    const updatedMemory: Memory =
      patchedMemory.meta.score === undefined
        ? {
            ...patchedMemory,
            meta: {
              ...patchedMemory.meta,
              score: currentMemory.meta.score,
            },
          }
        : patchedMemory;
    const writable = memoryToWritableColumns(updatedMemory);

    const writeSteps: Array<() => void> = [
      () => {
        this._database
          .query(
            `UPDATE memories
             SET summary = ?, text = ?, meta = ?, created_at = ?
             WHERE key = ?`,
          )
          .run(
            writable.summary,
            writable.text,
            writable.meta,
            writable.created_at,
            key,
          );
      },
    ];

    if (links) {
      writeSteps.push(() => {
        this.replaceLinkRelations(key, links, updatedMemory.meta.created_at);
      });
    }

    await runBatchInTransactionWithRetry(this._database, writeSteps, (step) => step(), {
      logger: console,
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

    const writeSteps: Array<() => void> = [
      () => {
        // Insert new key first so FK constraints stay valid for subsequent link updates.
        this._database
          .query(
            `INSERT INTO memories
             (key, summary, text, meta, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            newKey,
            writable.summary,
            writable.text,
            writable.meta,
            writable.created_at,
          );
      },
      () => {
        // Keep relation table synchronized for both outgoing and incoming edges.
        this._database
          .query(
            `UPDATE memory_links
             SET from_key = ?
             WHERE from_key = ?`,
          )
          .run(newKey, oldKey);
      },
      () => {
        this._database
          .query(
            `UPDATE memory_links
             SET to_key = ?
             WHERE to_key = ?`,
          )
          .run(newKey, oldKey);
      },
      () => {
        this._database.query(`DELETE FROM memories WHERE key = ?`).run(oldKey);
      },
    ];

    await runBatchInTransactionWithRetry(this._database, writeSteps, (step) => step(), {
      logger: console,
    });
  }

  /**
   * Optimize FTS5 index pages to improve search performance.
   *
   * Debug hint: if optimize fails repeatedly, inspect DB logs and FTS table existence.
   */
  async optimizeFtsIndex(): Promise<void> {
    if (!this._searchEnabled) {
      console.warn("KVMemory: optimizeFtsIndex skipped because search is disabled");
      return;
    }

    try {
      optimizeFtsIndexInDb(this._database);
      console.info("KVMemory: optimizeFtsIndex completed");
    } catch (error) {
      console.error("KVMemory: optimizeFtsIndex failed", error);
      throw error;
    }
  }

  /**
   * Rebuild FTS5 index objects and re-sync index content.
   *
   * Debug hint: if post-rebuild search is empty, verify trigger recreation and `memories` rows.
   */
  async rebuildFtsIndex(): Promise<void> {
    if (!this._searchEnabled) {
      console.warn("KVMemory: rebuildFtsIndex skipped because search is disabled");
      return;
    }

    try {
      rebuildFtsIndexInDb(this._database);
      console.info("KVMemory: rebuildFtsIndex completed");
    } catch (error) {
      console.error("KVMemory: rebuildFtsIndex failed", error);
      throw error;
    }
  }

  /**
   * Replace relation rows for one memory by provided links.
   *
   * Debug hint: if relation table misses expected rows, inspect `existsMemory()` filter.
   */
  private replaceLinkRelations(
    fromKey: string,
    links: MemoryLinkValue[],
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
      `INSERT INTO memory_links (from_key, to_key, link_type, term, weight, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const row of rows) {
      // Skip dangling target keys to keep relation rows valid.
      if (!this.existsMemory(row.to_key)) {
        continue;
      }

      insertLinkStatement.run(
        row.from_key,
        row.to_key,
        row.link_type,
        row.term,
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
        `SELECT key, summary, text, meta, created_at
         FROM memories
         WHERE key = ?
         LIMIT 1`,
      )
      .get(key) as MemoryRow | null;

    return row ?? undefined;
  }
}
