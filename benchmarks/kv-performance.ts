/**
 * KV performance benchmark: legacy Keyv baseline vs SQLite implementation.
 *
 * This benchmark compares add/get/update operations under equivalent data volume.
 * Debug entry point: inspect per-operation result rows if numbers look abnormal.
 */

import Keyv from "keyv";
import { KeyvSqlite } from "@keyv/sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { KVMemory } from "../src/libs/kv";
import { getDatabase, initDatabase } from "../src/libs/db";
import { MemoryStatusEnums, type Memory, type MemoryNoMeta } from "../src/type";

const OPERATIONS = 400;

type BenchmarkMetric = {
  operation: "add" | "get" | "update";
  implementation: "keyv" | "sqlite";
  totalMs: number;
  avgMs: number;
  throughputOpsPerSec: number;
};

/**
 * Legacy Keyv benchmark-only adapter.
 */
class KeyvMemoryBaseline {
  private kv: Keyv<Memory>;

  constructor(private namespace: string, filePath: string) {
    this.kv = new Keyv<Memory>(new KeyvSqlite({ uri: `sqlite://${filePath}` }), { namespace });
  }

  async add(key: string, arg: MemoryNoMeta): Promise<void> {
    const now = Date.now();
    const memory: Memory = {
      ...arg,
      meta: {
        id: key,
        created_at: now,
        last_accessed_at: now,
        last_linked_at: now,
        in_degree: 0,
        out_degree: 0,
        access_count: 0,
        traverse_count: 0,
        status: MemoryStatusEnums.parse("active"),
      },
    };
    await this.kv.set(key, memory);
  }

  async get(key: string): Promise<Memory | undefined> {
    return await this.kv.get(key);
  }

  async update(key: string, patch: Partial<Memory>): Promise<void> {
    const origin = await this.kv.get(key);
    if (!origin) {
      throw new Error(`KeyvMemoryBaseline: key ${key} not found`);
    }
    await this.kv.set(key, { ...origin, ...patch });
  }
}

/**
 * Run KV operation benchmark and print result table.
 */
export async function runKVPerformanceBenchmark(): Promise<BenchmarkMetric[]> {
  const namespaceKeyv = `bench_keyv_${Date.now()}`;
  const namespaceSqlite = `bench_sqlite_${Date.now()}`;
  const keyvDbPath = join(tmpdir(), `kv-bench-${Date.now()}.db`);

  const keyvImpl = new KeyvMemoryBaseline(namespaceKeyv, keyvDbPath);
  const sqliteImpl = new KVMemory();

  const records = buildRecords(OPERATIONS);

  try {
    const keyvMetrics = await runScenario("keyv", keyvImpl, records);
    const sqliteMetrics = await runScenario("sqlite", sqliteImpl, records);
    const merged = [...keyvMetrics, ...sqliteMetrics];

    printMetrics("KV Performance Benchmark", merged);
    return merged;
  } finally {
    cleanupSqliteNamespace(namespaceSqlite);
    rmSync(keyvDbPath, { force: true });
  }
}

async function runScenario(
  implementation: "keyv" | "sqlite",
  handler: { add: (key: string, arg: MemoryNoMeta) => Promise<void>; get: (key: string) => Promise<Memory | undefined>; update: (key: string, patch: Partial<Memory>) => Promise<void> },
  records: Array<{ key: string; value: MemoryNoMeta }>,
): Promise<BenchmarkMetric[]> {
  const addMetric = await measure("add", implementation, async () => {
    for (const record of records) {
      await handler.add(record.key, record.value);
    }
  });

  const getMetric = await measure("get", implementation, async () => {
    for (const record of records) {
      await handler.get(record.key);
    }
  });

  const updateMetric = await measure("update", implementation, async () => {
    for (const record of records) {
      await handler.update(record.key, {
        summary: `${record.value.summary}-updated`,
      });
    }
  });

  return [addMetric, getMetric, updateMetric];
}

async function measure(
  operation: "add" | "get" | "update",
  implementation: "keyv" | "sqlite",
  callback: () => Promise<void>,
): Promise<BenchmarkMetric> {
  const started = performance.now();
  await callback();
  const totalMs = performance.now() - started;

  return {
    operation,
    implementation,
    totalMs,
    avgMs: totalMs / OPERATIONS,
    throughputOpsPerSec: (OPERATIONS / totalMs) * 1000,
  };
}

function buildRecords(count: number): Array<{ key: string; value: MemoryNoMeta }> {
  const items: Array<{ key: string; value: MemoryNoMeta }> = [];
  for (let index = 0; index < count; index += 1) {
    items.push({
      key: `k_${index}`,
      value: {
        summary: `summary-${index}`,
        text: `text-${index}`,
        links: [],
      },
    });
  }

  return items;
}

function cleanupSqliteNamespace(namespace: string): void {
  const db = initDatabase(getDatabase()) as Database;
  db.query("DELETE FROM memory_links WHERE namespace = ?").run(namespace);
  db.query("DELETE FROM memories WHERE namespace = ?").run(namespace);
}

function printMetrics(title: string, metrics: BenchmarkMetric[]): void {
  console.log(`\n${title}`);
  console.log("operation\timplementation\ttotal_ms\tavg_ms\tthroughput_ops_s");
  for (const metric of metrics) {
    console.log(
      `${metric.operation}\t${metric.implementation}\t${metric.totalMs.toFixed(2)}\t${metric.avgMs.toFixed(4)}\t${metric.throughputOpsPerSec.toFixed(2)}`,
    );
  }
}

if (import.meta.main) {
  await runKVPerformanceBenchmark();
}
