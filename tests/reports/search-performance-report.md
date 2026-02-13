# Search Performance Report

Generated at: 2026-02-13T01:40:35.329Z

## Baseline Thresholds (ms)

| Dataset | Single | Multi | Pagination | Concurrency |
|---------|--------|-------|------------|-------------|
| small | 100 | 120 | 100 | 250 |
| medium | 180 | 220 | 180 | 500 |
| large | 400 | 500 | 420 | 1000 |

## Scenario Metrics

| Dataset | Size | Scenario | Response(ms) | Query(ms) | Memory(bytes) | Concurrency | Baseline(ms) | Status |
|---------|------|----------|--------------|-----------|---------------|-------------|--------------|--------|

## Notes
- Response time is measured around HTTP request lifecycle.
- Query execution time is measured around service-level search call.
- Memory metric is heap delta across scenario execution.
