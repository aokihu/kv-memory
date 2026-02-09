/**
 * Link traversal benchmark: JSON traversal (Keyv style) vs relation-table traversal.
 *
 * This benchmark uses the same graph topology for both strategies.
 * Debug entry point: inspect generated graph if traversal counts mismatch.
 */

import { Database } from "bun:sqlite";
import { initDatabase, getDatabase } from "../src/libs/db";
import { KVMemory } from "../src/libs/kv";
import type { Memory } from "../src/type";

const NODE_COUNT = 300;
const LINKS_PER_NODE = 4;

type LinkBenchmarkMetric = {
  mode: "json_scan" | "relation_query";
  totalMs: number;
  avgMsPerNode: number;
  throughputNodesPerSec: number;
  traversedEdges: number;
};

/**
 * Run link traversal benchmark and print summary table.
 */
export async function runLinkTraversalBenchmark(): Promise<LinkBenchmarkMetric[]> {
  const namespace = `bench_link_${Date.now()}`;
  const kv = new KVMemory(namespace);
  const db = initDatabase(getDatabase()) as Database;

  try {
    await seedGraph(kv, NODE_COUNT, LINKS_PER_NODE);

    const jsonMetric = await measureJsonScan(kv, NODE_COUNT);
    const relationMetric = measureRelationQuery(db, namespace, NODE_COUNT);
    const results = [jsonMetric, relationMetric];

    printMetrics("Link Traversal Benchmark", results);
    return results;
  } finally {
    db.query("DELETE FROM memory_links WHERE namespace = ?").run(namespace);
    db.query("DELETE FROM memories WHERE namespace = ?").run(namespace);
  }
}

async function seedGraph(kv: KVMemory, nodeCount: number, linksPerNode: number): Promise<void> {
  for (let index = 0; index < nodeCount; index += 1) {
    await kv.add(`node_${index}`, {
      domain: "bench",
      summary: `node-summary-${index}`,
      text: `node-text-${index}`,
      type: "design",
      keywords: ["graph", `${index}`],
      links: [],
    });
  }

  for (let index = 0; index < nodeCount; index += 1) {
    const links: Memory["links"] = [];
    for (let edge = 1; edge <= linksPerNode; edge += 1) {
      const target = (index + edge) % nodeCount;
      links.push({
        type: "design" as const,
        key: `node_${target}`,
        term: `edge-${index}-${target}`,
        weight: 0.5,
      });
    }

    await kv.update(`node_${index}`, { links });
  }
}

async function measureJsonScan(kv: KVMemory, nodeCount: number): Promise<LinkBenchmarkMetric> {
  let traversedEdges = 0;
  const started = performance.now();

  for (let index = 0; index < nodeCount; index += 1) {
    const memory = await kv.get(`node_${index}`);
    if (!memory) {
      continue;
    }
    traversedEdges += memory.links.length;
  }

  const totalMs = performance.now() - started;
  return {
    mode: "json_scan",
    totalMs,
    avgMsPerNode: totalMs / nodeCount,
    throughputNodesPerSec: (nodeCount / totalMs) * 1000,
    traversedEdges,
  };
}

function measureRelationQuery(db: Database, namespace: string, nodeCount: number): LinkBenchmarkMetric {
  let traversedEdges = 0;
  const query = db.query(
    `SELECT to_key, link_type, weight FROM memory_links WHERE namespace = ? AND from_key = ?`,
  );

  const started = performance.now();
  for (let index = 0; index < nodeCount; index += 1) {
    const rows = query.all(namespace, `node_${index}`) as Array<{ to_key: string; link_type: string; weight: number }>;
    traversedEdges += rows.length;
  }
  const totalMs = performance.now() - started;

  return {
    mode: "relation_query",
    totalMs,
    avgMsPerNode: totalMs / nodeCount,
    throughputNodesPerSec: (nodeCount / totalMs) * 1000,
    traversedEdges,
  };
}

function printMetrics(title: string, metrics: LinkBenchmarkMetric[]): void {
  console.log(`\n${title}`);
  console.log("mode\ttotal_ms\tavg_ms_per_node\tthroughput_nodes_s\ttraversed_edges");
  for (const metric of metrics) {
    console.log(
      `${metric.mode}\t${metric.totalMs.toFixed(2)}\t${metric.avgMsPerNode.toFixed(4)}\t${metric.throughputNodesPerSec.toFixed(2)}\t${metric.traversedEdges}`,
    );
  }
}

if (import.meta.main) {
  await runLinkTraversalBenchmark();
}
