/**
 * Search performance tests.
 *
 * Measures response time, memory deltas, and query execution timing
 * across multiple search scenarios and dataset sizes.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SearchController } from "../src/controller/searchController";
import { getDatabase, initDatabase } from "../src/libs/kv/db";
import { KVMemoryService } from "../src/service";

type DatasetProfile = {
  name: "small" | "medium" | "large";
  size: number;
};

type ScenarioName = "single_keyword" | "multi_keyword" | "pagination" | "concurrency";

type ScenarioMetric = {
  dataset: DatasetProfile["name"];
  datasetSize: number;
  scenario: ScenarioName;
  responseTimeMs: number;
  queryExecutionTimeMs: number;
  memoryUsedBytes: number;
  concurrency: number;
};

type SeedRecord = {
  key: string;
  summary: string;
  text: string;
};

const DATASET_PROFILES: DatasetProfile[] = [
  { name: "small", size: 80 },
  { name: "medium", size: 500 },
  { name: "large", size: 1500 },
];

const REPORT_DIR = join(process.cwd(), "tests", "reports");
const REPORT_PATH = join(REPORT_DIR, "search-performance-report.md");
const BASELINES: Record<DatasetProfile["name"], Record<ScenarioName, number>> = {
  small: {
    single_keyword: 100,
    multi_keyword: 120,
    pagination: 100,
    concurrency: 250,
  },
  medium: {
    single_keyword: 180,
    multi_keyword: 220,
    pagination: 180,
    concurrency: 500,
  },
  large: {
    single_keyword: 400,
    multi_keyword: 500,
    pagination: 420,
    concurrency: 1000,
  },
};

const db = initDatabase(getDatabase());
const collectedMetrics: ScenarioMetric[] = [];

function createPrefix(dataset: DatasetProfile): string {
  return `search_perf_${dataset.name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createSearchServer(service: KVMemoryService): ReturnType<typeof Bun.serve> {
  const controller = new SearchController(service);
  return Bun.serve({
    port: 0,
    routes: {
      "/search": {
        GET: (req) => controller.search(req),
      },
      "/fulltext": {
        GET: (req) => controller.fulltextSearch(req),
      },
    },
  });
}

function createSeedData(prefix: string, count: number): SeedRecord[] {
  const records: SeedRecord[] = [];

  for (let index = 0; index < count; index += 1) {
    const key = `${prefix}_mem_${index}`;
    const hasAlpha = index % 2 === 0;
    const hasBeta = index % 3 === 0;
    const hasGamma = index % 5 === 0;

    const tokens = [
      hasAlpha ? "alpha" : "delta",
      hasBeta ? "beta" : "epsilon",
      hasGamma ? "gamma" : "zeta",
      `group_${index % 20}`,
    ];

    records.push({
      key,
      summary: `record-${index} ${tokens[0]} ${tokens[1]}`,
      text: `dataset text ${tokens.join(" ")} index ${index}`,
    });
  }

  return records;
}

async function seedDataset(service: KVMemoryService, records: SeedRecord[]): Promise<void> {
  for (const record of records) {
    await service.addMemory(record.key, {
      summary: record.summary,
      text: record.text,
    });
  }
}

function getHeapUsedBytes(): number {
  return process.memoryUsage().heapUsed;
}

type DatasetContext = {
  service: KVMemoryService;
  server: ReturnType<typeof Bun.serve>;
  prefix: string;
  profile: DatasetProfile;
};

async function withSeededDataset(profile: DatasetProfile, callback: (ctx: DatasetContext) => Promise<void>): Promise<void> {
  const prefix = createPrefix(profile);
  const service = new KVMemoryService();
  const records = createSeedData(prefix, profile.size);
  const server = createSearchServer(service);

  await seedDataset(service, records);

  try {
    await callback({
      service,
      server,
      prefix,
      profile,
    });
  } finally {
    server.stop(true);
    cleanupByPrefix(prefix);
  }
}

function cleanupByPrefix(prefix: string): void {
  db.query("DELETE FROM memory_links WHERE from_key LIKE ? OR to_key LIKE ?").run(`${prefix}%`, `${prefix}%`);
  db.query("DELETE FROM memories WHERE key LIKE ?").run(`${prefix}%`);
}

function writePerformanceReport(metrics: ScenarioMetric[]): void {
  mkdirSync(REPORT_DIR, { recursive: true });

  const lines: string[] = [];
  lines.push("# Search Performance Report");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Baseline Thresholds (ms)");
  lines.push("");
  lines.push("| Dataset | Single | Multi | Pagination | Concurrency |");
  lines.push("|---------|--------|-------|------------|-------------|");

  for (const profile of DATASET_PROFILES) {
    const baseline = BASELINES[profile.name];
    lines.push(
      `| ${profile.name} | ${baseline.single_keyword} | ${baseline.multi_keyword} | ${baseline.pagination} | ${baseline.concurrency} |`,
    );
  }

  lines.push("");
  lines.push("## Scenario Metrics");
  lines.push("");
  lines.push("| Dataset | Size | Scenario | Response(ms) | Query(ms) | Memory(bytes) | Concurrency | Baseline(ms) | Status |");
  lines.push("|---------|------|----------|--------------|-----------|---------------|-------------|--------------|--------|");

  for (const metric of metrics) {
    const baseline = BASELINES[metric.dataset][metric.scenario];
    const status = metric.responseTimeMs <= baseline ? "PASS" : "WARN";

    lines.push(
      `| ${metric.dataset} | ${metric.datasetSize} | ${metric.scenario} | ${metric.responseTimeMs.toFixed(2)} | ${metric.queryExecutionTimeMs.toFixed(2)} | ${metric.memoryUsedBytes} | ${metric.concurrency} | ${baseline} | ${status} |`,
    );
  }

  lines.push("");
  lines.push("## Notes");
  lines.push("- Response time is measured around HTTP request lifecycle.");
  lines.push("- Query execution time is measured around service-level search call.");
  lines.push("- Memory metric is heap delta across scenario execution.");

  writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`, "utf8");
}

afterAll(() => {
  writePerformanceReport(collectedMetrics);
});

describe("search performance", () => {
  test("data generator creates expected dataset size", () => {
    for (const profile of DATASET_PROFILES) {
      const prefix = createPrefix(profile);
      const records = createSeedData(prefix, profile.size);

      expect(records.length).toBe(profile.size);
      expect(records[0].key.startsWith(prefix)).toBe(true);
      expect(records[0].summary.length > 0).toBe(true);
      expect(records[0].text.length > 0).toBe(true);
    }
  });

  test("single keyword performance", async () => {
    for (const profile of DATASET_PROFILES) {
      await withSeededDataset(profile, async ({ service, server, profile: dataset }) => {
        const memoryBefore = getHeapUsedBytes();

        const responseStarted = performance.now();
        const response = await fetch(`${server.url}/search?q=alpha&limit=10&offset=0`);
        const responseTimeMs = performance.now() - responseStarted;

        expect(response.status).toBe(200);
        const responsePayload = await response.json();
        expect(responsePayload.success).toBe(true);

        const queryStarted = performance.now();
        const queryPayload = await service.searchMemory("alpha", 10, 0);
        const queryExecutionTimeMs = performance.now() - queryStarted;

        expect(Array.isArray(queryPayload.results)).toBe(true);
        const memoryUsedBytes = Math.max(0, getHeapUsedBytes() - memoryBefore);

        collectedMetrics.push({
          dataset: dataset.name,
          datasetSize: dataset.size,
          scenario: "single_keyword",
          responseTimeMs,
          queryExecutionTimeMs,
          memoryUsedBytes,
          concurrency: 1,
        });
      });
    }
  });

  test("multi keyword performance", async () => {
    for (const profile of DATASET_PROFILES) {
      await withSeededDataset(profile, async ({ service, server, profile: dataset }) => {
        const memoryBefore = getHeapUsedBytes();

        const responseStarted = performance.now();
        const response = await fetch(`${server.url}/fulltext?keywords=alpha,beta&operator=AND&limit=20&offset=0`);
        const responseTimeMs = performance.now() - responseStarted;

        expect(response.status).toBe(200);
        const responsePayload = await response.json();
        expect(responsePayload.success).toBe(true);

        const queryStarted = performance.now();
        const queryPayload = await service.fulltextSearchMemory(["alpha", "beta"], "AND", 20, 0);
        const queryExecutionTimeMs = performance.now() - queryStarted;

        expect(Array.isArray(queryPayload.results)).toBe(true);
        const memoryUsedBytes = Math.max(0, getHeapUsedBytes() - memoryBefore);

        collectedMetrics.push({
          dataset: dataset.name,
          datasetSize: dataset.size,
          scenario: "multi_keyword",
          responseTimeMs,
          queryExecutionTimeMs,
          memoryUsedBytes,
          concurrency: 1,
        });
      });
    }
  });

  test("pagination performance", async () => {
    for (const profile of DATASET_PROFILES) {
      await withSeededDataset(profile, async ({ service, server, profile: dataset }) => {
        const memoryBefore = getHeapUsedBytes();

        const responseStarted = performance.now();
        const response = await fetch(`${server.url}/search?q=alpha&limit=25&offset=50`);
        const responseTimeMs = performance.now() - responseStarted;

        expect(response.status).toBe(200);
        const responsePayload = await response.json();
        expect(responsePayload.success).toBe(true);
        expect(responsePayload.data.pagination.limit).toBe(25);
        expect(responsePayload.data.pagination.offset).toBe(50);

        const queryStarted = performance.now();
        const queryPayload = await service.searchMemory("alpha", 25, 50);
        const queryExecutionTimeMs = performance.now() - queryStarted;

        expect(Array.isArray(queryPayload.results)).toBe(true);
        const memoryUsedBytes = Math.max(0, getHeapUsedBytes() - memoryBefore);

        collectedMetrics.push({
          dataset: dataset.name,
          datasetSize: dataset.size,
          scenario: "pagination",
          responseTimeMs,
          queryExecutionTimeMs,
          memoryUsedBytes,
          concurrency: 1,
        });
      });
    }
  });

  test("concurrency performance", async () => {
    const concurrencyLevel = 20;

    for (const profile of DATASET_PROFILES) {
      await withSeededDataset(profile, async ({ service, server, profile: dataset }) => {
        const memoryBefore = getHeapUsedBytes();

        const responseStarted = performance.now();
        const responses = await Promise.all(
          Array.from({ length: concurrencyLevel }, () => fetch(`${server.url}/search?q=alpha&limit=10&offset=0`)),
        );
        const responseTimeMs = performance.now() - responseStarted;

        for (const response of responses) {
          expect(response.status).toBe(200);
          const payload = await response.json();
          expect(payload.success).toBe(true);
        }

        const queryStarted = performance.now();
        const queryResults = await Promise.all(
          Array.from({ length: concurrencyLevel }, () => service.searchMemory("alpha", 10, 0)),
        );
        const queryExecutionTimeMs = performance.now() - queryStarted;

        for (const item of queryResults) {
          expect(Array.isArray(item.results)).toBe(true);
        }

        const memoryUsedBytes = Math.max(0, getHeapUsedBytes() - memoryBefore);

        collectedMetrics.push({
          dataset: dataset.name,
          datasetSize: dataset.size,
          scenario: "concurrency",
          responseTimeMs,
          queryExecutionTimeMs,
          memoryUsedBytes,
          concurrency: concurrencyLevel,
        });
      });
    }
  });
});
