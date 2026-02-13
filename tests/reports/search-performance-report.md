# Search Performance Report

Generated at: 2026-02-13T13:15:49.456Z

## Baseline Thresholds (ms)

| Dataset | Single | Multi | Pagination | Concurrency |
|---------|--------|-------|------------|-------------|
| small | 100 | 120 | 100 | 250 |
| medium | 180 | 220 | 180 | 500 |
| large | 400 | 500 | 420 | 1000 |

## Scenario Metrics

| Dataset | Size | Scenario | Response(ms) | Query(ms) | Memory(bytes) | Concurrency | Baseline(ms) | Status |
|---------|------|----------|--------------|-----------|---------------|-------------|--------------|--------|
| small | 80 | single_keyword | 6.20 | 1.46 | 36774 | 1 | 100 | PASS |
| medium | 500 | single_keyword | 5.43 | 1.47 | 0 | 1 | 180 | PASS |
| large | 1500 | single_keyword | 4.73 | 1.45 | 2528 | 1 | 400 | PASS |
| small | 80 | multi_keyword | 4.02 | 1.17 | 10450 | 1 | 120 | PASS |
| medium | 500 | multi_keyword | 3.96 | 1.39 | 1584 | 1 | 220 | PASS |
| large | 1500 | multi_keyword | 7.84 | 2.17 | 9616 | 1 | 500 | PASS |
| small | 80 | pagination | 3.53 | 0.78 | 13528 | 1 | 100 | PASS |
| medium | 500 | pagination | 3.71 | 1.50 | 728 | 1 | 180 | PASS |
| large | 1500 | pagination | 4.05 | 2.05 | 15440 | 1 | 420 | PASS |
| small | 80 | concurrency | 23.49 | 14.47 | 16596 | 20 | 250 | PASS |
| medium | 500 | concurrency | 25.09 | 18.38 | 79099 | 20 | 500 | PASS |
| large | 1500 | concurrency | 32.68 | 24.21 | 23888 | 20 | 1000 | PASS |

## Notes
- Response time is measured around HTTP request lifecycle.
- Query execution time is measured around service-level search call.
- Memory metric is heap delta across scenario execution.
