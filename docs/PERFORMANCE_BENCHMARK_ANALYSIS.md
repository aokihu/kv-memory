# Performance Benchmark Analysis

## Scope

This document summarizes benchmark results for:

- Key operation performance (`add`, `get`, `update`) comparing Keyv baseline and current SQLite implementation
- Link traversal performance comparing JSON scan and relation-table query

## Environment

- Runtime: Bun
- Project benchmark scripts:
  - `bun run benchmarks/index.ts`
  - `bun run benchmarks/kv-performance.ts`
  - `bun run benchmarks/link-traversal.ts`

## Method

### KV Operation Benchmark

- Dataset size: 400 records
- Same memory payload shape for both implementations
- Measured metrics:
  - total latency (`total_ms`)
  - average latency per operation (`avg_ms`)
  - throughput (`ops/s`)

### Link Traversal Benchmark

- Graph size: 300 nodes
- Outgoing edges per node: 4 (total edges: 1200)
- Compared traversal paths:
  - `json_scan`: read memory then parse links from JSON field
  - `relation_query`: query `memory_links` relation table by `(namespace, from_key)`

## Latest Results

Source run: `bun run benchmarks/index.ts`

### KV Performance

| operation | implementation | total_ms | avg_ms | throughput_ops_s |
|-----------|----------------|----------|--------|------------------|
| add | keyv | 64.67 | 0.1617 | 6185.54 |
| get | keyv | 35.50 | 0.0887 | 11268.01 |
| update | keyv | 81.49 | 0.2037 | 4908.54 |
| add | sqlite | 557.27 | 1.3932 | 717.78 |
| get | sqlite | 8.69 | 0.0217 | 46048.88 |
| update | sqlite | 561.49 | 1.4037 | 712.39 |

### Link Traversal

| mode | total_ms | avg_ms_per_node | throughput_nodes_s | traversed_edges |
|------|----------|-----------------|--------------------|-----------------|
| json_scan | 8.83 | 0.0294 | 33978.64 | 1200 |
| relation_query | 1.91 | 0.0064 | 157017.59 | 1200 |

## Interpretation

- SQLite implementation shows significantly faster `get` in this benchmark setup.
- Current SQLite `add` and `update` are slower than Keyv baseline due to explicit transactional writes and relation synchronization.
- Relation-table traversal is substantially faster than JSON-link scanning for graph traversal workload.
- Performance profile indicates read/traversal optimization goals are achieved, while write-heavy workloads may need future optimization (outside this task scope).
