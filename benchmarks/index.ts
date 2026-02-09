/**
 * Benchmark entrypoint runner.
 */

import { runKVPerformanceBenchmark } from "./kv-performance";
import { runLinkTraversalBenchmark } from "./link-traversal";

/**
 * Run all benchmark suites sequentially.
 */
export async function runAllBenchmarks(): Promise<void> {
  console.log("Starting benchmark suites...");
  await runKVPerformanceBenchmark();
  await runLinkTraversalBenchmark();
  console.log("Benchmark suites completed.");
}

if (import.meta.main) {
  await runAllBenchmarks();
}
