/**
 * MEM-DECAY-049 benchmark tests for decay algorithm and batch processor.
 * Focus: repeatable performance sampling, trend analysis, memory stability, and concurrency throughput.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import {
  computeDecayScore,
  getDecayAlgorithmMetricsReport,
  resetDecayAlgorithmMetrics,
  getDecayAlgorithmLogConfig,
  updateDecayAlgorithmLogConfig,
} from "../src/libs/decay/algorithm";
import { processMemoriesInBatches } from "../src/libs/decay/processor";

type BenchmarkSample = {
  name: string;
  operations: number;
  totalMs: number;
  avgMs: number;
  p95Ms: number;
  throughputPerSec: number;
};

type ScenarioReport = {
  section: string;
  samples: BenchmarkSample[];
  trend: string;
};

const BENCHMARK_REPORT: ScenarioReport[] = [];
const FIXED_NOW_MS = 1_760_000_000_000;
const SQLITE_INSERT_CHUNK = 500;

const BASE_DECAY_CONFIG = {
  minScore: 0,
  maxScore: 100,
  intervalMs: 60_000,
  batchSize: 200,
  thresholds: {
    activeMinScore: 70,
    coldMinScore: 40,
  },
  weights: {
    minTimeDecayFactor: 0.95,
    maxUsageBoost: 10,
    maxStructureBoost: 5,
  },
} as const;

const TUNED_CONFIGS = [
  {
    name: "conservative",
    config: {
      ...BASE_DECAY_CONFIG,
      intervalMs: 90_000,
      weights: {
        ...BASE_DECAY_CONFIG.weights,
        maxUsageBoost: 6,
        maxStructureBoost: 3,
      },
    },
  },
  {
    name: "balanced",
    config: {
      ...BASE_DECAY_CONFIG,
    },
  },
  {
    name: "aggressive",
    config: {
      ...BASE_DECAY_CONFIG,
      intervalMs: 30_000,
      weights: {
        ...BASE_DECAY_CONFIG.weights,
        maxUsageBoost: 10,
        maxStructureBoost: 5,
      },
    },
  },
] as const;

const MEMORY_SCALES = [1_000, 3_000, 6_000] as const;

const previousLogConfig = getDecayAlgorithmLogConfig();

function nsToMs(ns: bigint): number {
  return Number(ns) / 1_000_000;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[index] ?? 0;
}

function createBenchmarkSample(name: string, durationsMs: number[], operations: number): BenchmarkSample {
  const totalMs = durationsMs.reduce((sum, value) => sum + value, 0);
  const avgMs = operations > 0 ? totalMs / operations : 0;
  const p95Ms = percentile(durationsMs, 0.95);
  const throughputPerSec = totalMs > 0 ? (operations / totalMs) * 1_000 : 0;

  return {
    name,
    operations,
    totalMs,
    avgMs,
    p95Ms,
    throughputPerSec,
  };
}

function createMemoryFixture(index: number, nowMs: number = FIXED_NOW_MS): Record<string, unknown> {
  const accessCount = (index % 32) + 1;
  const inDegree = index % 7;
  const outDegree = index % 5;

  return {
    key: `bench-memory-${index}`,
    summary: `summary-${index}`,
    text: `text-${index}`,
    meta: {
      score: 20 + (index % 70),
      last_accessed_at: nowMs - (index % 86_400) * 1_000,
      access_count: accessCount,
      in_degree: inDegree,
      out_degree: outDegree,
    },
  };
}

function createMemoryDataset(size: number, nowMs: number = FIXED_NOW_MS): Array<Record<string, unknown>> {
  const dataset: Array<Record<string, unknown>> = [];
  for (let index = 0; index < size; index += 1) {
    dataset.push(createMemoryFixture(index, nowMs));
  }
  return dataset;
}

function computeTrendByValue(samples: BenchmarkSample[], key: "totalMs" | "throughputPerSec"): string {
  if (samples.length < 2) {
    return "single_point";
  }

  const first = samples[0]?.[key] ?? 0;
  const last = samples[samples.length - 1]?.[key] ?? 0;
  if (key === "totalMs") {
    return last >= first ? "up" : "down";
  }
  return last >= first ? "up" : "down";
}

function analyzeScaleTrend(samples: BenchmarkSample[]): string {
  // Debug anchor: if this fails, inspect per-size throughput to check for environment contention.
  const throughput = samples.map((item) => item.throughputPerSec);
  if (throughput.length < 2) {
    return "insufficient";
  }

  let stableTransitions = 0;
  for (let index = 1; index < throughput.length; index += 1) {
    const previous = throughput[index - 1] ?? 0;
    const current = throughput[index] ?? 0;
    if (previous === 0) {
      continue;
    }

    const ratio = current / previous;
    if (ratio >= 0.55) {
      stableTransitions += 1;
    }
  }

  return stableTransitions >= throughput.length - 1 ? "stable" : "degraded";
}

function measureSingleScoreBenchmark(iterations: number, config: Record<string, unknown>): BenchmarkSample {
  const memory = createMemoryFixture(42);
  const durationsMs: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const started = process.hrtime.bigint();
    const result = computeDecayScore(memory as never, config as never, FIXED_NOW_MS);
    const ended = process.hrtime.bigint();
    durationsMs.push(nsToMs(ended - started));

    // Debug branch: if benchmark is invalid, score must always stay in configured range.
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  }

  return createBenchmarkSample("single-score", durationsMs, iterations);
}

function initializeBenchmarkDb(totalRows: number): Database {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE memories (key TEXT PRIMARY KEY, summary TEXT NOT NULL, text TEXT NOT NULL, meta TEXT, score INTEGER, created_at INTEGER)",
  );

  const values: string[] = [];
  for (let index = 0; index < totalRows; index += 1) {
    const memory = createMemoryFixture(index);
    const meta = JSON.stringify((memory.meta ?? {}) as Record<string, unknown>).split("'").join("''");
    const summary = String(memory.summary).split("'").join("''");
    const text = String(memory.text).split("'").join("''");
    const score = (memory.meta as Record<string, number>).score ?? 50;
    values.push(
      `('bench-${index}','${summary}','${text}','${meta}',${score},${FIXED_NOW_MS - index})`,
    );

    if (values.length >= SQLITE_INSERT_CHUNK || index === totalRows - 1) {
      db.exec(
        `INSERT INTO memories (key, summary, text, meta, score, created_at) VALUES ${values.join(",")}`,
      );
      values.length = 0;
    }
  }

  return db;
}

async function measureBatchProcessingBenchmark(totalRows: number, batchSize: number): Promise<BenchmarkSample> {
  const db = initializeBenchmarkDb(totalRows);
  let operationCount = 0;
  const started = process.hrtime.bigint();

  try {
    const stats = await processMemoriesInBatches(
      db,
      {
        ...BASE_DECAY_CONFIG,
        batchSize,
        batchDelayMs: 0,
        maxRetries: 1,
        retryDelayMs: 0,
        transactionTimeoutMs: 10_000,
      } as never,
      batchSize,
      (row) => {
        const parsedMeta =
          typeof row.meta === "string" ? (JSON.parse(row.meta) as Record<string, unknown>) : ((row.meta ?? {}) as Record<string, unknown>);
        computeDecayScore(
          {
            key: row.key,
            summary: row.summary,
            text: row.text,
            meta: {
              score: Number(parsedMeta.score ?? row.score ?? 50),
              last_accessed_at: Number(parsedMeta.last_accessed_at ?? FIXED_NOW_MS),
              access_count: Number(parsedMeta.access_count ?? 1),
              in_degree: Number(parsedMeta.in_degree ?? 0),
              out_degree: Number(parsedMeta.out_degree ?? 0),
            },
          } as never,
          BASE_DECAY_CONFIG as never,
          FIXED_NOW_MS,
        );
        operationCount += 1;
      },
    );

    expect(stats.failedBatches).toBe(0);
    expect(stats.processedMemories).toBe(totalRows);
    expect(stats.interrupted).toBe(false);
  } finally {
    db.close();
  }

  const ended = process.hrtime.bigint();
  return createBenchmarkSample(`batch-${totalRows}`, [nsToMs(ended - started)], operationCount);
}

function benchmarkConfigImpact(iterations: number): BenchmarkSample[] {
  const memory = createMemoryFixture(88);
  const samples: BenchmarkSample[] = [];

  for (const entry of TUNED_CONFIGS) {
    const durationsMs: number[] = [];
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const started = process.hrtime.bigint();
      const result = computeDecayScore(memory as never, entry.config as never, FIXED_NOW_MS);
      const ended = process.hrtime.bigint();
      durationsMs.push(nsToMs(ended - started));

      expect(result.status === "active" || result.status === "cold" || result.status === "deprecated").toBe(true);
    }

    samples.push(createBenchmarkSample(`config-${entry.name}`, durationsMs, iterations));
  }

  return samples;
}

function getHeapUsedMb(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

function runMemoryLeakProbe(rounds: number, roundSize: number): BenchmarkSample {
  const memoryGrowth: number[] = [];
  const startedHeap = getHeapUsedMb();
  const started = process.hrtime.bigint();
  let operations = 0;

  for (let round = 0; round < rounds; round += 1) {
    const dataset = createMemoryDataset(roundSize, FIXED_NOW_MS + round);
    for (const memory of dataset) {
      computeDecayScore(memory as never, BASE_DECAY_CONFIG as never, FIXED_NOW_MS + round);
      operations += 1;
    }

    memoryGrowth.push(getHeapUsedMb() - startedHeap);
  }

  const ended = process.hrtime.bigint();
  const sample = createBenchmarkSample("memory-leak-probe", [nsToMs(ended - started)], operations);

  const head = memoryGrowth.slice(0, Math.max(1, Math.floor(memoryGrowth.length / 2)));
  const tail = memoryGrowth.slice(Math.max(0, Math.floor(memoryGrowth.length / 2)));
  const headAvg = head.reduce((sum, value) => sum + value, 0) / Math.max(1, head.length);
  const tailAvg = tail.reduce((sum, value) => sum + value, 0) / Math.max(1, tail.length);
  const driftMb = tailAvg - headAvg;

  // Debug branch: if this fails, inspect per-round growth to identify retained references.
  expect(driftMb).toBeLessThan(35);
  expect(Math.max(...memoryGrowth)).toBeLessThan(220);

  return sample;
}

async function runConcurrentBenchmark(workers: number, operationsPerWorker: number): Promise<BenchmarkSample> {
  const started = process.hrtime.bigint();
  const tasks: Array<Promise<number>> = [];

  for (let worker = 0; worker < workers; worker += 1) {
    tasks.push(
      Promise.resolve().then(() => {
        let processed = 0;
        for (let index = 0; index < operationsPerWorker; index += 1) {
          const memory = createMemoryFixture(worker * operationsPerWorker + index, FIXED_NOW_MS + worker);
          const result = computeDecayScore(memory as never, BASE_DECAY_CONFIG as never, FIXED_NOW_MS + worker);
          if (result.score >= 0 && result.score <= 100) {
            processed += 1;
          }
        }
        return processed;
      }),
    );
  }

  const counts = await Promise.all(tasks);
  const ended = process.hrtime.bigint();
  const total = counts.reduce((sum, value) => sum + value, 0);
  expect(total).toBe(workers * operationsPerWorker);

  return createBenchmarkSample("concurrent", [nsToMs(ended - started)], total);
}

function appendScenario(section: string, samples: BenchmarkSample[], trend: string): void {
  BENCHMARK_REPORT.push({ section, samples, trend });
}

describe("decay benchmark performance", () => {
  beforeEach(() => {
    resetDecayAlgorithmMetrics();
    updateDecayAlgorithmLogConfig({
      enabled: false,
      outputs: { console: false, file: false, remote: false },
      maxInMemoryRecords: 50,
    });
  });

  afterAll(() => {
    updateDecayAlgorithmLogConfig(previousLogConfig);
  });

  test("single score computation benchmark", () => {
    const warmup = 300;
    measureSingleScoreBenchmark(warmup, BASE_DECAY_CONFIG);

    const benchmark = measureSingleScoreBenchmark(8_000, BASE_DECAY_CONFIG);
    appendScenario("single_score", [benchmark], "single_point");

    expect(benchmark.avgMs).toBeLessThan(1.5);
    expect(benchmark.throughputPerSec).toBeGreaterThan(500);
  });

  test("batch memory processing benchmark", async () => {
    const benchmark = await measureBatchProcessingBenchmark(5_000, 250);
    appendScenario("batch_processing", [benchmark], computeTrendByValue([benchmark], "throughputPerSec"));

    expect(benchmark.operations).toBe(5_000);
    expect(benchmark.throughputPerSec).toBeGreaterThan(300);
  }, 20_000);

  test("performance across different memory scales", async () => {
    const samples: BenchmarkSample[] = [];
    for (const size of MEMORY_SCALES) {
      const sample = await measureBatchProcessingBenchmark(size, 250);
      samples.push(sample);
    }

    const trend = analyzeScaleTrend(samples);
    appendScenario("memory_scale", samples, trend);

    const durations = samples.map((item) => item.totalMs);
    expect(durations[1]).toBeGreaterThan(durations[0] * 0.55);
    expect(durations[2]).toBeGreaterThan(durations[1] * 0.55);
    expect(trend === "stable" || trend === "degraded").toBe(true);
  }, 25_000);

  test("performance impact under different config profiles", () => {
    const samples = benchmarkConfigImpact(3_000);
    const trend = computeTrendByValue(samples, "throughputPerSec");
    appendScenario("config_impact", samples, trend);

    for (const sample of samples) {
      expect(sample.avgMs).toBeGreaterThan(0);
      expect(sample.p95Ms).toBeGreaterThanOrEqual(sample.avgMs * 0.3);
    }
  }, 20_000);

  test("memory usage and leak probe", () => {
    const sample = runMemoryLeakProbe(6, 1_200);
    appendScenario("memory_stability", [sample], "stable");

    expect(sample.operations).toBe(7_200);
    expect(sample.totalMs).toBeGreaterThan(0);
  }, 15_000);

  test("concurrent throughput benchmark", async () => {
    const sample = await runConcurrentBenchmark(8, 1_000);
    appendScenario("concurrency", [sample], "stable");

    expect(sample.operations).toBe(8_000);
    expect(sample.throughputPerSec).toBeGreaterThan(300);
  }, 15_000);

  test("generate benchmark report and trend analysis", () => {
    const expectedSections = [
      "single_score",
      "batch_processing",
      "memory_scale",
      "config_impact",
      "memory_stability",
      "concurrency",
    ];

    for (const section of expectedSections) {
      const found = BENCHMARK_REPORT.find((item) => item.section === section);
      expect(found).toBeDefined();
      expect((found?.samples.length ?? 0) > 0).toBe(true);
      expect(typeof found?.trend === "string").toBe(true);
    }

    const metricsReport = getDecayAlgorithmMetricsReport();
    expect(metricsReport.generatedAt).toBeGreaterThan(0);

    const printable = BENCHMARK_REPORT.map((scenario) => ({
      section: scenario.section,
      trend: scenario.trend,
      operations: scenario.samples.reduce((sum, item) => sum + item.operations, 0),
      avgMs: Number(
        (
          scenario.samples.reduce((sum, item) => sum + item.avgMs, 0) /
          Math.max(1, scenario.samples.length)
        ).toFixed(4),
      ),
      throughput: Number(
        (
          scenario.samples.reduce((sum, item) => sum + item.throughputPerSec, 0) /
          Math.max(1, scenario.samples.length)
        ).toFixed(2),
      ),
    }));

    // Debug entry: report table helps compare trend drift across repeated runs.
    console.info("[MEM-DECAY-049] benchmark trend report");
    console.table(printable);
  });
});
