# Search Performance Report

Generated at: 2026-02-12T08:51:05.265Z

## Baseline Thresholds (ms)

| Dataset | Single | Multi | Pagination | Concurrency |
|---------|--------|-------|------------|-------------|
| small | 100 | 120 | 100 | 250 |
| medium | 180 | 220 | 180 | 500 |
| large | 400 | 500 | 420 | 1000 |

## Scenario Metrics

| Dataset | Size | Scenario | Response(ms) | Query(ms) | Memory(bytes) | Concurrency | Baseline(ms) | Status |
|---------|------|----------|--------------|-----------|---------------|-------------|--------------|--------|
| small | 80 | single_keyword | 7.61 | 0.64 | 302829 | 1 | 100 | PASS |
| medium | 500 | single_keyword | 2.31 | 0.86 | 44616 | 1 | 180 | PASS |
| large | 1500 | single_keyword | 2.55 | 0.92 | 54248 | 1 | 400 | PASS |
| small | 80 | multi_keyword | 3.35 | 0.76 | 10451 | 1 | 120 | PASS |
| medium | 500 | multi_keyword | 3.06 | 1.11 | 728 | 1 | 220 | PASS |
| large | 1500 | multi_keyword | 2.70 | 0.99 | 12736 | 1 | 500 | PASS |
| small | 80 | pagination | 3.53 | 0.46 | 11296 | 1 | 100 | PASS |
| medium | 500 | pagination | 2.64 | 1.06 | 34424 | 1 | 180 | PASS |
| large | 1500 | pagination | 3.06 | 1.50 | 4608 | 1 | 420 | PASS |
| small | 80 | concurrency | 25.81 | 11.48 | 76766 | 20 | 250 | PASS |
| medium | 500 | concurrency | 19.95 | 11.97 | 0 | 20 | 500 | PASS |
| large | 1500 | concurrency | 28.35 | 22.70 | 22240 | 20 | 1000 | PASS |

## Notes
- Response time is measured around HTTP request lifecycle.
- Query execution time is measured around service-level search call.
- Memory metric is heap delta across scenario execution.
