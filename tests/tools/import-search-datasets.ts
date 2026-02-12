/**
 * Search test dataset import tool.
 *
 * What it does:
 * - Loads JSON datasets under `tests/data/search`.
 * - Imports records into KV storage for search-related tests.
 *
 * Why this exists:
 * - Keeps search fixtures reusable and deterministic across test runs.
 *
 * Debug hint:
 * - If import fails with JSON parse errors, validate dataset file syntax first.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDatabase, initDatabase } from "../../src/libs/kv/db";
import { KVMemoryService } from "../../src/service";

type MemoryRecord = {
  key: string;
  summary: string;
  text: string;
};

type GeneratorConfig = {
  prefix: string;
  count: number;
  summaryTemplate: string;
  textTemplate: string;
  tokenPools: Record<string, string[]>;
  groupModulo: number;
};

type DatasetFile = {
  dataset: string;
  description?: string;
  records?: MemoryRecord[];
  generator?: GeneratorConfig;
};

const DATASET_DIR = resolve(process.cwd(), "tests/data/search");
const DEFAULT_DATASETS = [
  "diverse-memories",
  "basic-search",
  "fulltext-search",
  "performance-search",
  "edge-cases-search",
];

/**
 * Build deterministic text from template placeholders.
 */
function formatTemplate(template: string, values: Record<string, string | number>): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.split(`{{${key}}}`).join(String(value));
  }
  return output;
}

/**
 * Deterministically generate records for performance dataset.
 */
function generateRecords(config: GeneratorConfig): MemoryRecord[] {
  const records: MemoryRecord[] = [];
  const tokenA = config.tokenPools.tokenA ?? ["alpha"];
  const tokenB = config.tokenPools.tokenB ?? ["search"];
  const tokenC = config.tokenPools.tokenC ?? ["fts5"];
  const lang = config.tokenPools.lang ?? ["en"];
  const marker = config.tokenPools.marker ?? ["hot"];

  for (let index = 0; index < config.count; index += 1) {
    const values = {
      index,
      tokenA: tokenA[index % tokenA.length],
      tokenB: tokenB[index % tokenB.length],
      tokenC: tokenC[index % tokenC.length],
      lang: lang[index % lang.length],
      marker: marker[index % marker.length],
      group: index % Math.max(config.groupModulo, 1),
    };

    records.push({
      key: `${config.prefix}:${String(index).padStart(4, "0")}`,
      summary: formatTemplate(config.summaryTemplate, values),
      text: formatTemplate(config.textTemplate, values),
    });
  }

  return records;
}

/**
 * Parse CLI flags to select datasets.
 */
function parseRequestedDatasets(argv: string[]): string[] {
  const datasetFlag = argv.find((arg) => arg.startsWith("--dataset="));
  const allFlag = argv.includes("--all");

  if (allFlag || !datasetFlag) {
    return DEFAULT_DATASETS;
  }

  const value = datasetFlag.slice("--dataset=".length).trim();
  if (value.length === 0) {
    return DEFAULT_DATASETS;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Read and parse dataset json file.
 */
function readDatasetFile(datasetName: string): DatasetFile {
  const filePath = join(DATASET_DIR, `${datasetName}.json`);
  const content = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(content) as DatasetFile;
  return parsed;
}

/**
 * Remove previous imported rows by deterministic test prefixes.
 */
function cleanupTestPrefixes(prefixes: string[]): void {
  const db = initDatabase(getDatabase());
  for (const prefix of prefixes) {
    db.query("DELETE FROM memory_links WHERE from_key LIKE ? OR to_key LIKE ?").run(`${prefix}%`, `${prefix}%`);
    db.query("DELETE FROM memories WHERE key LIKE ?").run(`${prefix}%`);
  }
}

/**
 * Main import flow.
 */
async function main(): Promise<void> {
  const requestedDatasets = parseRequestedDatasets(process.argv.slice(2));
  const available = new Set(readdirSync(DATASET_DIR).filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, "")));
  const unknown = requestedDatasets.filter((name) => !available.has(name));

  if (unknown.length > 0) {
    throw new Error(`Unknown dataset(s): ${unknown.join(", ")}`);
  }

  cleanupTestPrefixes(["test:search:"]);

  const service = new KVMemoryService();
  let importedCount = 0;

  for (const datasetName of requestedDatasets) {
    const dataset = readDatasetFile(datasetName);
    const records = dataset.records ?? (dataset.generator ? generateRecords(dataset.generator) : []);

    for (const record of records) {
      await service.addMemory(record.key, {
        summary: record.summary,
        text: record.text,
      });
      importedCount += 1;
    }

    console.log(`[import] ${datasetName}: ${records.length} records`);
  }

  console.log(`[done] imported ${importedCount} records from ${requestedDatasets.length} dataset(s)`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[failed] ${message}`);
  process.exitCode = 1;
});
