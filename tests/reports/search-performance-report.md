# Search Performance Report

Generated at: 2026-02-14T06:13:39.773Z

## Baseline Thresholds (ms)

| Dataset | Single | Multi | Pagination | Concurrency |
|---------|--------|-------|------------|-------------|
| small | 100 | 120 | 100 | 250 |
| medium | 180 | 220 | 180 | 500 |
| large | 400 | 500 | 420 | 1000 |

## Scenario Metrics

| Dataset | Size | Scenario | Response(ms) | Query(ms) | Memory(bytes) | Concurrency | Baseline(ms) | Status |
|---------|------|----------|--------------|-----------|---------------|-------------|--------------|--------|
| small | 80 | single_keyword | 4.77 | 1.30 | 38998 | 1 | 100 | PASS |
| medium | 500 | single_keyword | 6.66 | 1.64 | 0 | 1 | 180 | PASS |
| large | 1500 | single_keyword | 5.34 | 1.17 | 679373 | 1 | 400 | PASS |
| small | 80 | multi_keyword | 3.89 | 1.19 | 10450 | 1 | 120 | PASS |
| medium | 500 | multi_keyword | 3.49 | 1.24 | 1584 | 1 | 220 | PASS |
| large | 1500 | multi_keyword | 4.17 | 1.62 | 30488 | 1 | 500 | PASS |
| small | 80 | pagination | 2.95 | 0.63 | 11296 | 1 | 100 | PASS |
| medium | 500 | pagination | 3.61 | 1.43 | 728 | 1 | 180 | PASS |
| large | 1500 | pagination | 4.16 | 1.86 | 24424 | 1 | 420 | PASS |
| small | 80 | concurrency | 24.06 | 10.84 | 16596 | 20 | 250 | PASS |
| medium | 500 | concurrency | 22.61 | 15.65 | 79099 | 20 | 500 | PASS |
| large | 1500 | concurrency | 29.07 | 23.05 | 45936 | 20 | 1000 | PASS |

## Notes
- Response time is measured around HTTP request lifecycle.
- Query execution time is measured around service-level search call.
- Memory metric is heap delta across scenario execution.
